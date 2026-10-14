#!/usr/bin/env node
/**
 * NoCap Edit YouTube helper.
 *
 * A browser cannot fetch a YouTube video by itself (no CORS, signed per-viewer
 * URLs), so this small service does the one step the static site can't: it runs
 * yt-dlp and streams back a browser-playable MP4 (H.264 + AAC). The site then
 * stores the file in the visitor's browser like any dropped recording; nothing
 * about the visitor's projects ever reaches this service.
 *
 * Routes (all GET, CORS enabled):
 *   /health                      -> { ok, ytdlp }
 *   /info?url=<link>             -> { id, title, duration, thumbnail, uploader, heights }
 *   /download?url=<link>&height= -> video/mp4 body, X-Video-Title / X-Video-Id headers
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
 *   YTDLP_COOKIES contents of a Netscape cookies.txt exported from a signed-in YouTube
 *                 session; written to a temp file and passed as --cookies. Gets past
 *                 "Sign in to confirm you're not a bot" on data-centre addresses.
 */
import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { availableHeights, canonicalUrl, formatSelector, safeTitle, youtubeVideoId } from "./lib.mjs";

const PORT = Number(process.env.PORT) || 3131;
const HOST = process.env.HOST || "127.0.0.1";
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || "*";
const MAX_SECONDS = (Number(process.env.MAX_MINUTES) || 180) * 60;
const MAX_JOBS = Number(process.env.MAX_JOBS) || 2;
const YTDLP = process.env.YTDLP || "yt-dlp";
const EXTRA_ARGS = (process.env.YTDLP_ARGS || "").split(" ").filter(Boolean);
if (process.env.YTDLP_COOKIES) {
  const cookieFile = path.join(tmpdir(), `nocap-yt-cookies-${process.pid}.txt`);
  await writeFile(cookieFile, process.env.YTDLP_COOKIES.replace(/\\n/g, "\n"), { mode: 0o600 });
  EXTRA_ARGS.push("--cookies", cookieFile);
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

/** Runs yt-dlp, resolving with stdout; rejects with the last useful stderr line. */
function runYtDlp(args, { timeoutMs, signal }) {
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
      reject(new Error(last.replace(/^ERROR:\s*(\[[^\]]+\]\s*[\w-]{11}:\s*)?/, "")));
    });
  });
}

function parseLink(url, res) {
  const id = youtubeVideoId(url);
  if (!id) {
    json(res, 400, { error: "That is not a YouTube video link." });
    return null;
  }
  return id;
}

async function handleInfo(req, res, params) {
  const id = parseLink(params.get("url"), res);
  if (!id) return;
  try {
    const raw = await runYtDlp(["-J", "--no-playlist", "--no-warnings", canonicalUrl(id)], { timeoutMs: INFO_TIMEOUT_MS });
    const info = JSON.parse(raw);
    json(res, 200, {
      id,
      title: info.title ?? "YouTube video",
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
  const id = parseLink(params.get("url"), res);
  if (!id) return;
  if (running >= MAX_JOBS) return json(res, 429, { error: `The helper is busy with ${MAX_JOBS} downloads. Try again in a minute.` });
  running++;
  const abort = new AbortController();
  req.on("close", () => abort.abort());
  const dir = await mkdtemp(path.join(tmpdir(), "nocap-yt-"));
  const started = Date.now();
  try {
    const out = await runYtDlp(
      [
        "-f", formatSelector(params.get("height")),
        "--merge-output-format", "mp4",
        "--no-playlist", "--no-warnings", "--no-progress",
        "--match-filters", `!is_live & duration<=${MAX_SECONDS}`,
        "-o", path.join(dir, "video.%(ext)s"),
        "--print", "after_move:%(.{filepath,title,id,duration})j",
        canonicalUrl(id),
      ],
      { timeoutMs: DOWNLOAD_TIMEOUT_MS, signal: abort.signal },
    );
    const line = out.trim().split("\n").filter(Boolean).pop();
    if (!line) throw new Error(`The video is live or longer than ${Math.round(MAX_SECONDS / 60)} minutes, so the helper skipped it.`);
    const meta = JSON.parse(line);
    const size = (await stat(meta.filepath)).size;
    const title = safeTitle(meta.title);
    console.log(`[download] ${id} "${title}" ${(size / 1e6).toFixed(1)} MB in ${((Date.now() - started) / 1000).toFixed(0)} s`);
    res.writeHead(200, {
      "Content-Type": "video/mp4",
      "Content-Length": size,
      "Content-Disposition": `attachment; filename="${title.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}.mp4"; filename*=UTF-8''${encodeURIComponent(title)}.mp4`,
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
  if (url.pathname === "/health" || url.pathname === "/") {
    try {
      const v = await runYtDlp(["--version"], { timeoutMs: 10_000 });
      return json(res, 200, { ok: true, ytdlp: v.trim(), maxMinutes: MAX_SECONDS / 60 });
    } catch (e) {
      return json(res, 500, { ok: false, error: e.message });
    }
  }
  if (url.pathname === "/info") return handleInfo(req, res, url.searchParams);
  if (url.pathname === "/download") return handleDownload(req, res, url.searchParams);
  json(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`NoCap Edit YouTube helper listening on http://${HOST}:${PORT} (yt-dlp: ${YTDLP}, up to ${MAX_SECONDS / 60} min per video)`);
});
