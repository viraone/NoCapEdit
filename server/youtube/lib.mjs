/**
 * Pure helpers for the YouTube helper service (no I/O), so they can be unit-tested
 * from vitest without starting the server.
 */

/** Video heights the site can ask for, best first. */
export const QUALITIES = [1080, 720, 480, 360];

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * Returns the 11-character video id when `input` is a YouTube link, else null.
 * Accepts watch, short, shorts, live and embed links on youtube.com, youtu.be,
 * m.youtube.com and music.youtube.com, with or without a scheme.
 */
export function youtubeVideoId(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const check = (id) => (id && VIDEO_ID.test(id) ? id : null);
  if (host === "youtu.be") return check(url.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com" && host !== "youtube-nocookie.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "watch") return check(url.searchParams.get("v"));
  if (["shorts", "live", "embed", "v"].includes(parts[0])) return check(parts[1]);
  return null;
}

/** The link handed to yt-dlp: one canonical form, so playlist and tracking parameters never come along. */
export function canonicalUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/**
 * yt-dlp format selector for a browser-playable MP4: H.264 video up to `height`
 * plus AAC audio, falling back to any MP4 at that height. Same recipe as the
 * youtube-mp4 skill, which produces files ffmpeg.wasm and <video> both decode.
 */
export function formatSelector(height) {
  const h = QUALITIES.includes(Number(height)) ? Number(height) : 1080;
  return `bv*[vcodec^=avc1][height<=${h}]+ba[ext=m4a]/b[ext=mp4][height<=${h}]/bv*[height<=${h}]+ba/b`;
}

/** A file name browsers and the site's importer are happy with. */
export function safeTitle(title) {
  const clean = String(title ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || "YouTube video").slice(0, 120);
}

/** Distinct H.264 heights available for the video, best first, from a yt-dlp info dict. */
export function availableHeights(info) {
  const heights = new Set();
  for (const f of info?.formats ?? []) {
    const vcodec = String(f.vcodec ?? "");
    if (!f.height || vcodec === "none") continue;
    if (!vcodec.startsWith("avc1")) continue;
    for (const q of QUALITIES) if (f.height >= q) heights.add(q);
  }
  // Nothing H.264 at all (rare): offer every step and let the fallback selector choose.
  if (heights.size === 0) return [...QUALITIES];
  return [...heights].sort((a, b) => b - a);
}
