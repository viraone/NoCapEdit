/**
 * Pure helpers for the YouTube helper service (no I/O), so they can be unit-tested
 * from vitest without starting the server.
 */

/** Video heights the site can ask for, best first. */
export const QUALITIES = [1080, 720, 480, 360];

/** What the site can ask for: the video as MP4, or just its sound as MP3. */
export const FORMATS = ["mp4", "mp3"];

/** "mp3" when asked for, otherwise "mp4". */
export function outputFormat(format) {
  return String(format ?? "").toLowerCase() === "mp3" ? "mp3" : "mp4";
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Instagram shortcodes are 11 characters for ordinary posts and reels; some older or private-account posts run longer. */
const SHORTCODE = /^[A-Za-z0-9_-]{5,40}$/;

/** `input` as a URL when it is an http(s) web address (scheme optional), else null. */
function webUrl(input) {
  if (typeof input !== "string") return null;
  const text = input.trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}

/**
 * Returns the 11-character video id when `input` is a YouTube link, else null.
 * Accepts watch, short, shorts, live and embed links on youtube.com, youtu.be,
 * m.youtube.com and music.youtube.com, with or without a scheme.
 */
export function youtubeVideoId(input) {
  const url = webUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const check = (id) => (id && VIDEO_ID.test(id) ? id : null);
  if (host === "youtu.be") return check(url.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com" && host !== "youtube-nocookie.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "watch") return check(url.searchParams.get("v"));
  if (["shorts", "live", "embed", "v"].includes(parts[0])) return check(parts[1]);
  return null;
}

/**
 * Returns the shortcode when `input` is an Instagram reel, post or IGTV link, else null.
 * Accepts /reel/, /reels/, /p/ and /tv/ on instagram.com, m.instagram.com and instagr.am,
 * with or without a username in front (the app's "Copy link" sometimes adds one) and
 * with or without a scheme. /share/ links are opaque redirect tokens, not shortcodes,
 * so they are refused; the visitor can open one in a browser and copy the real address.
 */
export function instagramShortcode(input) {
  const url = webUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "instagram.com" && host !== "m.instagram.com" && host !== "instagr.am") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "share") return null;
  for (let i = 0; i + 1 < parts.length; i++) {
    if (["reel", "reels", "p", "tv"].includes(parts[i]) && SHORTCODE.test(parts[i + 1])) return parts[i + 1];
  }
  return null;
}

/** Which site a pasted link belongs to and the id the helper fetches by, or null when it is neither. */
export function parseMediaLink(input) {
  const videoId = youtubeVideoId(input);
  if (videoId) return { source: "youtube", id: videoId };
  const shortcode = instagramShortcode(input);
  if (shortcode) return { source: "instagram", id: shortcode };
  return null;
}

/** The link handed to yt-dlp: one canonical form, so playlist and tracking parameters never come along. */
export function canonicalUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The canonical link for either site. */
export function canonicalMediaUrl({ source, id }) {
  return source === "instagram" ? `https://www.instagram.com/reel/${id}/` : canonicalUrl(id);
}

/** What a download is called before its real title is known. */
export function defaultTitle(source) {
  return source === "instagram" ? "Instagram reel" : "YouTube video";
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

/**
 * yt-dlp format selector for an Instagram reel: the same H.264 + AAC preference with
 * no height cap. Reels are vertical (1080×1920), so a `height<=1080` rule would pick
 * a shrunken copy over the original.
 */
export function instagramSelector() {
  return "bv*[vcodec^=avc1]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b";
}

/** yt-dlp format selector for sound only: the AAC track, else the best audio there is. ffmpeg turns it into MP3. */
export function audioSelector() {
  return "ba[ext=m4a]/ba";
}

/**
 * The yt-dlp arguments that decide what comes out: a merged MP4 (up to `height` for
 * YouTube, full size for an Instagram reel), or an MP3 (highest VBR quality)
 * extracted from the best audio track.
 */
export function outputArgs(format, height, source = "youtube") {
  if (outputFormat(format) === "mp3") return ["-f", audioSelector(), "-x", "--audio-format", "mp3", "--audio-quality", "0"];
  return ["-f", source === "instagram" ? instagramSelector() : formatSelector(height), "--merge-output-format", "mp4"];
}

/** A file name browsers and the site's importer are happy with; `fallback` when the title is empty. */
export function safeTitle(title, fallback = "Video") {
  const clean = String(title ?? "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (clean || fallback).slice(0, 120);
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
