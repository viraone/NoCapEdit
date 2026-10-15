/** YouTube link parsing for the start screen's paste bar (mirrors server/youtube/lib.mjs). */

/** Video heights offered in the quality picker, best first. */
export const YOUTUBE_QUALITIES = [1080, 720, 480, 360] as const;
export type YouTubeQuality = (typeof YOUTUBE_QUALITIES)[number];

/** What the bar can ask the helper for: the video (becomes a project) or just its sound (saved as a file). */
export const YOUTUBE_FORMATS = ["mp4", "mp3"] as const;
export type YouTubeFormat = (typeof YOUTUBE_FORMATS)[number];

/** What the visitor asked for with one pasted link. */
export interface YouTubeChoice {
  format: YouTubeFormat;
  /** Video height; ignored for MP3. */
  quality: YouTubeQuality;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The 11-character video id when `input` is a YouTube link, else null.
 * Accepts watch, youtu.be, shorts, live and embed links on youtube.com,
 * m.youtube.com and music.youtube.com, with or without a scheme.
 */
export function youtubeVideoId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const check = (id: string | null | undefined) => (id && VIDEO_ID.test(id) ? id : null);
  if (host === "youtu.be") return check(url.pathname.split("/")[1]);
  if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "music.youtube.com" && host !== "youtube-nocookie.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "watch") return check(url.searchParams.get("v"));
  if (["shorts", "live", "embed", "v"].includes(parts[0])) return check(parts[1]);
  return null;
}

/** One canonical link per video, so the helper never sees playlist or tracking parameters. */
export function youtubeWatchUrl(id: string): string {
  return `https://www.youtube.com/watch?v=${id}`;
}
