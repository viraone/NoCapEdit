#!/usr/bin/env node
/**
 * NoCap Edit download helper for YouTube videos and Instagram reels.
 *
 * A browser cannot fetch a YouTube video or an Instagram reel by itself (no CORS,
 * signed per-viewer URLs), so this small service does the one step the static site
 * can't: it runs yt-dlp and streams back a browser-playable MP4 (H.264 + AAC). The
 * site then stores the file in the visitor's browser like any dropped recording;
 * nothing about the visitor's projects ever reaches this service.
 *
 * Routes (all GET, CORS enabled; <link> is a YouTube or Instagram video link):
 *   /health                      -> { ok, ytdlp }
 *   /info?url=<link>             -> { id, source, title, duration, thumbnail, uploader, heights }
 *   /download?url=<link>&height= -> video/mp4 body, X-Video-Title / X-Video-Id headers
 *                                   (height applies to YouTube; a reel comes at its full size)
 *   /download?url=<link>&format=mp3 -> audio/mpeg body (sound only), same headers
 *
 * Needs yt-dlp and ffmpeg on PATH. Zero npm dependencies.
 *
 * Environment:
 *   PORT          listen port (3131)
 *   HOST          bind address (127.0.0.1; use 0.0.0.0 in a container)
 *   ALLOW_ORIGIN  Access-Control-Allow-Origin ("*"; set to https://nocapedit.com when hosted)
 *   MAX_MINUTES   longest video accepted (180)
 *   MAX_JOBS      downloads running at once (2)
 *   YTDLP         yt-dlp executable (yt-dlp)
 *   YTDLP_ARGS    extra arguments, split on spaces (e.g. "--cookies /data/cookies.txt")
 *   YTDLP_COOKIES a Netscape cookies.txt exported from a browser signed in to YouTube
 *                 and/or Instagram, as plain text or base64 (one line); written to a temp
 *                 file and passed as --cookies. Gets past YouTube's "Sign in to confirm
 *                 you're not a bot" on data-centre addresses, and Instagram's habit of
 *                 demanding a signed-in session before it hands over even a public reel.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { availableHeights, canonicalMediaUrl, defaultTitle, outputArgs, outputFormat, parseMediaLink, safeTitle } from "./lib.mjs";

const PORT = Number(process.env.PORT) || 3131;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const MAX_SECONDS = (Number(process.env.MAX_MINUTES) || 180) * 60;
const MAX_JOBS = Number(process.env.MAX_JOBS) || 2;
const YTDLP = process.env.YTDLP || "yt-dlp";
const EXTRA_ARGS = (process.env.YTDLP_ARGS || "").split(" ").filter(Boolean);
if (process.env.YTDLP_COOKIES) {
  const cookieFile = path.join(tmpdir(), `nocap-yt-cookies-${process.pid}.txt`);
  await writeFile(cookieFile, decodeCookies(process.env.YTDLP_COOKIES), { mode: 0o600 });
  EXTRA_ARGS.push("--cookies", cookieFile);
  console.log("yt-dlp will use the cookies from YTDLP_COOKIES");
}

/**
 * YTDLP_COOKIES may be the cookies.txt text itself (real newlines or literal "\n"),
 * or that text base64-encoded, which pastes into any single-line settings box
 * without losing the tabs the Netscape format needs.
 */
function decodeCookies(value) {
  const raw = value.trim();
  if (raw.startsWith("#") || raw.includes("\t")) return raw.replace(/\\n/g, "\n");
  if (/^[A-Za-z0-9+/=\s]+$/.test(raw)) {
    const text = Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8");
    if (text.includes("\t")) return text;
  }
  return raw.replace(/\\n/g, "\n");
}
/** yt-dlp -J on a long video can take a few seconds; a download much longer. */
const INFO_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

let running = 0;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOW_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "Content-Length, Content-Disposition, X-Video-Title, X-Video-Id, X-Video-Duration");
  // Chrome asks before a public https page may talk to 127.0.0.1 (Private Network Access).
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  // The site is cross-origin isolated (COEP: require-corp); CORS already satisfies it, this is belt and braces.
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  res.setHeader("Cache-Control", "no-store");
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Turns yt-dlp's wording into something a visitor can act on. */
function friendlyError(message, source = "youtube") {
  if (source === "instagram") {
    if (/empty media response|login required|rate-?limit|not available|cookies|sign ?in|log ?in/i.test(message)) {
      return "Instagram wouldn't hand over this reel. It may be private, or Instagram is asking the helper to sign in first (it often does, even for public reels). The site owner can fix the sign-in part by giving the helper Instagram cookies (see server/youtube/README.md). Meanwhile, save the reel from the Instagram app and drop the file in.";
    }
    if (/unsupported url|no video|is not a video|no formats|image/i.test(message)) return "That Instagram post doesn't contain a video.";
    return message;
  }
  if (/cookies are no longer valid|rotated/i.test(message)) {
    return "The helper's YouTube cookies have expired or been rotated. The site owner needs to export fresh ones (see server/youtube/README.md). Meanwhile, drop a video file instead.";
  }
  if (/not a bot|cookies/i.test(message)) {
    return "YouTube is blocking the helper's server right now (its bot check). The site owner can fix this by giving the helper cookies (see server/youtube/README.md). Meanwhile, drop a video file instead.";
  }
  if (/private video|members-only|sign in to confirm your age|age-restricted/i.test(message)) return "This video is private, members-only or age-restricted, so it can't be fetched.";
  if (/video unavailable|has been removed|does not exist/i.test(message)) return "That video isn't available on YouTube (removed, or the link is wrong).";
  if (/premieres|is live|live event/i.test(message)) return "Live streams and premieres can't be fetched until they've finished.";
  return message;
}

/** Runs yt-dlp, resolving with stdout; rejects with the last useful stderr line. */
function runYtDlp(args, { timeoutMs, signal, source }) {
  return new Promise((resolve, reject) => {
    const child = spawn(YTDLP, [...EXTRA_ARGS, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    const onAbort = () => child.kill("SIGKILL");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e.code === "ENOENT" ? new Error(`${YTDLP} is not installed on the helper (brew install yt-dlp)`) : e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) return reject(new Error("cancelled"));
      if (code === 0) return resolve(out);
      const lines = err.split("\n").map((l) => l.trim()).filter(Boolean);
      const last = lines.filter((l) => l.startsWith("ERROR")).pop() ?? lines.pop() ?? `yt-dlp exited with ${code}`;
      // The raw wording goes to the server log; the browser gets the friendly version.
      console.log(`[yt-dlp] ${last.slice(0, 400)}`);
      reject(new Error(friendlyError(last.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]+:\s*)?/, ""), source)));
    });
  });
}

function parseLink(url, res) {
  const link = parseMediaLink(url);
  if (!link) {
    json(res, 400, { error: "That is not a YouTube or Instagram video link." });
    return null;
  }
  return link;
}

async function handleInfo(req, res, params) {
  const link = parseLink(params.get("url"), res);
  if (!link) return;
  const { id, source } = link;
  try {
    const raw = await runYtDlp(["-J", "--no-playlist", "--no-warnings", canonicalMediaUrl(link)], { timeoutMs: INFO_TIMEOUT_MS, source });
    const info = JSON.parse(raw);
    json(res, 200, {
      id,
      source,
      title: info.title ?? defaultTitle(source),
      duration: Number(info.duration) || 0,
      thumbnail: info.thumbnail ?? null,
      uploader: info.uploader ?? info.channel ?? null,
      heights: availableHeights(info),
      maxSeconds: MAX_SECONDS,
    });
  } catch (e) {
    json(res, 502, { error: e.message });
  }
}

async function handleDownload(req, res, params) {
  const link = parseLink(params.get("url"), res);
  if (!link) return;
  const { id, source } = link;
  if (running >= MAX_JOBS) return json(res, 429, { error: `The helper is busy with ${MAX_JOBS} downloads. Try again in a minute.` });
  running++;
  const abort = new AbortController();
  req.on("close", () => abort.abort());
  const dir = await mkdtemp(path.join(tmpdir(), "nocap-yt-"));
  const format = outputFormat(params.get("format"));
  const started = Date.now();
  try {
    const out = await runYtDlp(
      [
        ...outputArgs(format, params.get("height"), source),
        "--no-playlist", "--no-warnings", "--no-progress",
        "--match-filters", `!is_live & duration<=${MAX_SECONDS}`,
        "-o", path.join(dir, "media.%(ext)s"),
        // after_move runs once every post-processor is done, so for MP3 the path is the converted file.
        "--print", "after_move:%(.{filepath,title,id,duration})j",
        canonicalMediaUrl(link),
      ],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, signal: abort.signal, source },
    );
    const line = out.trim().split("\n").filter(Boolean).pop();
    if (!line) throw new Error(`The video is live or longer than ${Math.round(MAX_SECONDS / 60)} minutes, so the helper skipped it.`);
    const meta = JSON.parse(line);
    const size = (await stat(meta.filepath)).size;
    const title = safeTitle(meta.title, defaultTitle(source));
    console.log(`[download] ${source}:${id} "${title}" ${format} ${(size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    res.writeHead(200, {
      "Content-Type": format === "mp3" ? "audio/mpeg" : "video/mp4",
      "Content-Length": size,
      "Content-Disposition": `attachment; filename="${title.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}.${format}"; filename*=UTF-8''${encodeURIComponent(title)}.${format}`,
      "X-Video-Title": encodeURIComponent(title),
      "X-Video-Id": id,
      "X-Video-Duration": String(meta.duration ?? 0),
    });
    await new Promise((resolve) => {
      const stream = createReadStream(meta.filepath);
      stream.on("error", resolve);
      res.on("close", resolve);
      stream.pipe(res).on("finish", resolve);
    });
  } catch (e) {
    if (abort.signal.aborted) console.log(`[download] ${id} cancelled by the browser`);
    else {
      console.log(`[download] ${id} failed: ${e.message}`);
      if (!res.headersSent) json(res, 502, { error: e.message });
    }
    if (!res.writableEnded) res.end();
  } finally {
    running--;
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== "GET") return json(res, 405, { error: "GET only" });
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  // Answers at once: hosts poll this every few seconds with a short timeout, and
  // spawning yt-dlp (a self-extracting binary) can take longer than that on a small CPU.
  if (url.pathname === "/health" || url.pathname === "/") {
    return json(res, 200, { ok: true, ytdlp: ytdlpVersion, maxMinutes: MAX_SECONDS / 60 });
  }
  if (url.pathname === "/info") return handleInfo(req, res, url.searchParams);
  if (url.pathname === "/download") return handleDownload(req, res, url.searchParams);
  json(res, 404, { error: "Not found" });
});

/** Looked up once after start-up, reported by /health ("checking…" until then, "missing" if yt-dlp isn't installed). */
let ytdlpVersion = "checking";

server.listen(PORT, HOST, () => {
  console.log(`NoCap Edit YouTube / Instagram helper listening on http://${HOST}:${PORT} (yt-dlp: ${YTDLP}, up to ${MAX_SECONDS / 60} min per video)`);
  runYtDlp(["--version"], { timeoutMs: 60_000 })
    .then((v) => {
      ytdlpVersion = v.trim();
      console.log(`yt-dlp ${ytdlpVersion} ready`);
    })
    .catch((e) => {
      ytdlpVersion = "missing";
      console.error(`yt-dlp check failed: ${e.message}`);
    });
});
