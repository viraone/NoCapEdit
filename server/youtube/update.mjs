/**
 * Keeps the helper's yt-dlp current without a rebuild.
 *
 * Render only rebuilds this service when a file under server/youtube/ changes, so the
 * yt-dlp nightly baked into the image goes stale while YouTube keeps changing; an old
 * binary starts failing with "Failed to extract any player response" long before anyone
 * touches this folder. When the container starts (the free tier starts it on every
 * wake-up), this checks the nightly releases and, when a newer build exists, downloads
 * it, checks it against the release's published SHA2-256SUMS, and swaps it in for the
 * next download. Any failure is logged and the current binary keeps working.
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

export const RELEASES_URL = "https://api.github.com/repos/yt-dlp/yt-dlp-nightly-builds/releases/latest";

const run = promisify(execFile);

/** The release asset for this host: the Unix zipapp, which needs python3 (the Dockerfile installs it). */
export function binaryAssetName(platform = process.platform) {
  return platform === "linux" || platform === "darwin" ? "yt-dlp" : null;
}

/** True when `version` (yt-dlp --version) is the same build as release tag `tag`. */
export function isCurrent(version, tag) {
  return String(version ?? "").trim() === String(tag ?? "").trim();
}

/**
 * The SHA-256 published for `file` in a release's SHA2-256SUMS body, or null when the
 * file is not listed. Lines look like "<64 hex characters>  yt-dlp" (a "*" before the
 * name marks a binary upload, and some tools use CRLF line ends).
 */
export function checksumFor(sums, file) {
  for (const line of String(sums ?? "").split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim());
    if (match && match[2].trim() === file) return match[1].toLowerCase();
  }
  return null;
}

/** SHA-256 of a buffer as lowercase hex. */
export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function download(fetchImpl, url, headers, signal) {
  const res = await fetchImpl(url, { headers, signal, redirect: "follow" });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
}

/**
 * Replaces the yt-dlp binary at `targetPath` with the latest nightly when it is not
 * already that build. Resolves with { updated, version }; rejects (after leaving the old
 * binary untouched) when anything goes wrong. `targetPath` must be writable by this
 * process; the Dockerfile puts it in /app/bin for that reason.
 */
export async function updateYtDlp({
  currentVersion,
  targetPath,
  asset = binaryAssetName(),
  fetch: fetchImpl = globalThis.fetch,
  log = console.log,
  timeoutMs = 180_000,
}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const headers = { "user-agent": "nocap-edit-youtube-helper", accept: "application/vnd.github+json" };

  const release = await (await download(fetchImpl, RELEASES_URL, headers, signal)).json();
  const tag = String(release.tag_name ?? "").trim();
  if (!tag) throw new Error("the release feed has no tag_name");
  if (isCurrent(currentVersion, tag)) return { updated: false, version: tag };
  if (!asset) throw new Error(`no yt-dlp release build for ${process.platform}`);

  const assets = new Map((release.assets ?? []).map((a) => [a.name, a.browser_download_url]));
  const binaryUrl = assets.get(asset);
  const sumsUrl = assets.get("SHA2-256SUMS");
  if (!binaryUrl || !sumsUrl) throw new Error(`nightly ${tag} has no ${asset} or SHA2-256SUMS asset`);

  const [sums, binary] = await Promise.all([
    download(fetchImpl, sumsUrl, headers, signal).then((res) => res.text()),
    download(fetchImpl, binaryUrl, headers, signal).then(async (res) => Buffer.from(await res.arrayBuffer())),
  ]);
  const expected = checksumFor(sums, asset);
  if (!expected) throw new Error(`SHA2-256SUMS for ${tag} names no ${asset}`);
  if (sha256(binary) !== expected) throw new Error(`${asset} from nightly ${tag} failed its checksum`);

  // Write beside the target and rename over it: a download that is already running keeps
  // the old file, and the next one gets the new build, with no half-written binary in view.
  // The staged build must run here first, or a nightly that outgrew the host's Python
  // would replace a working yt-dlp with one that cannot start.
  const staging = `${targetPath}.new-${process.pid}`;
  await writeFile(staging, binary, { mode: 0o755 });
  try {
    const { stdout } = await run(staging, ["--version"], { timeout: 60_000 });
    if (!isCurrent(stdout, tag)) throw new Error(`it reports ${stdout.trim() || "no version"}`);
  } catch (e) {
    await rm(staging, { force: true });
    throw new Error(`${asset} from nightly ${tag} does not run on this host: ${String(e.message).split("\n")[0]}`);
  }
  await rename(staging, targetPath);
  log(`yt-dlp updated ${currentVersion} -> ${tag}`);
  return { updated: true, version: tag };
}
