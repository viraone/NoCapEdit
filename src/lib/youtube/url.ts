/** YouTube and Instagram link parsing for the start screen's paste bar (mirrors server/youtube/lib.mjs). */

/** Video heights offered in the quality picker, best first. */
export const YOUTUBE_QUALITIES = [1080, 720, 480, 360] as const;
export type YouTubeQuality = (typeof YOUTUBE_QUALITIES)[number];

/** What the bar can ask the helper for: the video (becomes a project) or just its sound (saved as a file). */
export const YOUTUBE_FORMATS = ["mp4", "mp3"] as const;
export type YouTubeFormat = (typeof YOUTUBE_FORMATS)[number];

/** What the visitor asked for with one pasted link. */
export interface YouTubeChoice {
  format: YouTubeFormat;
  /** Video height; ignored for MP3 and for Instagram, whose reels come at their own size. */
  quality: YouTubeQuality;
}

/** The sites the bar accepts links from. */
export type MediaSource = "youtube" | "instagram";

/** Which site a pasted link belongs to and the id the helper fetches by. */
export interface MediaLink {
  source: MediaSource;
  /** YouTube's 11-character video id, or Instagram's shortcode. */
  id: string;
}

export const SITE_NAME: Record<MediaSource, string> = { youtube: "YouTube", instagram: "Instagram" };

/** What a download is called before its real title is known. */
export function defaultTitle(source: MediaSource): string {
  return source === "instagram" ? "Instagram reel" : "YouTube video";
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Instagram shortcodes are 11 characters for ordinary posts and reels; some older or private-account posts run longer. */
const SHORTCODE = /^[A-Za-z0-9_-]{5,40}$/;

/** `input` as a URL when it is an http(s) web address (scheme optional), else null. */
function webUrl(input: string): URL | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  return url.protocol === "https:" || url.protocol === "http:" ? url : null;
}

/**
 * The 11-character video id when `input` is a YouTube link, else null.
 * Accepts watch, youtu.be, shorts, live and embed links on youtube.com,
 * m.youtube.com and music.youtube.com, with or without a scheme.
 */
export function youtubeVideoId(input: string): string | null {
  const url = webUrl(input);
  if (!url) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const check = (id: string | null | undefined) => (id && VIDEO_ID.test(id) ? id : null);
  if (host === "youtu.be") return check(url.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com" && host !== "youtube-nocookie.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "watch") return check(url.searchParams.get("v"));
  if (["shorts", "live", "embed", "v"].includes(parts[0])) return check(parts[1]);
  return null;
}

/**
 * The shortcode when `input` is an Instagram reel, post or IGTV link, else null.
 * Accepts /reel/, /reels/, /p/ and /tv/ on instagram.com, m.instagram.com and instagr.am,
 * with or without a username in front (the app's "Copy link" sometimes adds one) and
 * with or without a scheme. /share/ links are opaque redirect tokens, not shortcodes,
 * so they are refused; the visitor can open one in a browser and copy the real address.
 */
export function instagramShortcode(input: string): string | null {
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

/** The site and id behind a pasted link, or null when it is neither a YouTube nor an Instagram video link. */
export function parseMediaLink(input: string): MediaLink | null {
  const videoId = youtubeVideoId(input);
  if (videoId) return { source: "youtube", id: videoId };
  const shortcode = instagramShortcode(input);
  if (shortcode) return { source: "instagram", id: shortcode };
  return null;
}

/** One canonical link per video, so the helper never sees playlist or tracking parameters. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}

/** The canonical link for either site. */
export function mediaUrl({ source, id }: MediaLink): string {
  return source === "instagram" ? `https://www.instagram.com/reel/${id}/` : youtubeWatchUrl(id);
}
