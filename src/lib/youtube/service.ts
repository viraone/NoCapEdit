/**
 * Client for the YouTube helper (server/youtube/server.mjs): the one job the
 * static site cannot do in the browser. The helper fetches the video with
 * yt-dlp and streams back an MP4; everything after that (storage, captions,
 * export) stays on the visitor's device like any dropped recording.
 *
 * Which helper is used, in order:
 *   1. localStorage "nocap.youtubeService" (set from the console to test a hosted copy)
 *   2. NEXT_PUBLIC_YOUTUBE_SERVICE_URL at build time (the hosted helper for visitors)
 *   3. http://127.0.0.1:3131, the helper started with `npm run youtube` on this computer
 */
import { youtubeWatchUrl } from "./url";

export const DEFAULT_YOUTUBE_SERVICE = "http://127.0.0.1:3131";
export const YOUTUBE_SERVICE_KEY = "nocap.youtubeService";

export function youtubeServiceUrl(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(YOUTUBE_SERVICE_KEY);
  } catch {
    /* private mode or no storage */
  }
  return (stored?.trim() || process.env.NEXT_PUBLIC_YOUTUBE_SERVICE_URL || DEFAULT_YOUTUBE_SERVICE).replace(/\/+$/, "");
}

export interface YouTubeInfo {
  id: string;
  title: string;
  /** Seconds, 0 when unknown. */
  duration: number;
  thumbnail: string | null;
  uploader: string | null;
  /** Heights the helper can deliver, best first. */
  heights: number[];
  /** Longest video the helper accepts, seconds. */
  maxSeconds: number;
}

export type YouTubeErrorKind = "unreachable" | "rejected" | "cancelled";

export class YouTubeServiceError extends Error {
  constructor(
    message: string,
    public readonly kind: YouTubeErrorKind,
  ) {
    super(message);
    this.name = "YouTubeServiceError";
  }
}

/** What to tell the visitor when nothing answers at the helper's address. */
export function unreachableText(base = youtubeServiceUrl()): string {
  const local = base === DEFAULT_YOUTUBE_SERVICE;
  return local
    ? "The YouTube helper isn't running on this computer. Start it with \"npm run youtube\" in the NoCap Edit folder, then try again."
    : `Can't reach the YouTube helper at ${base}. Try again in a minute.`;
}

async function serviceFetch(path: string, signal?: AbortSignal): Promise<Response> {
  const base = youtubeServiceUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { signal, mode: "cors" });
  } catch (e) {
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw new YouTubeServiceError("Cancelled", "cancelled");
    throw new YouTubeServiceError(unreachableText(base), "unreachable");
  }
  if (!res.ok) {
    let message = `The YouTube helper answered ${res.status}.`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new YouTubeServiceError(message, "rejected");
  }
  return res;
}

export async function fetchYouTubeInfo(id: string, signal?: AbortSignal): Promise<YouTubeInfo> {
  const res = await serviceFetch(`/info?url=${encodeURIComponent(youtubeWatchUrl(id))}`, signal);
  const info = (await res.json()) as Partial<YouTubeInfo>;
  return {
    id,
    title: info.title || "YouTube video",
    duration: Number(info.duration) || 0,
    thumbnail: info.thumbnail ?? null,
    uploader: info.uploader ?? null,
    heights: Array.isArray(info.heights) && info.heights.length ? info.heights : [1080, 720, 480, 360],
    maxSeconds: Number(info.maxSeconds) || 0,
  };
}

export interface YouTubeDownload {
  file: File;
  title: string;
  duration: number;
}

/**
 * Streams the MP4 from the helper into a File so it can go through the normal
 * import path. `onProgress` starts once the helper has the video and begins
 * sending it; before that the helper is still talking to YouTube.
 */
export async function downloadYouTube(id: string, height: number, onProgress?: (loaded: number, total: number | null) => void, signal?: AbortSignal): Promise<YouTubeDownload> {
  const res = await serviceFetch(`/download?url=${encodeURIComponent(youtubeWatchUrl(id))}&height=${height}`, signal);
  const title = decodeURIComponent(res.headers.get("X-Video-Title") || "") || "YouTube video";
  const duration = Number(res.headers.get("X-Video-Duration")) || 0;
  const total = Number(res.headers.get("Content-Length")) || null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  onProgress?.(0, total);
  const reader = res.body?.getReader();
  try {
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        onProgress?.(loaded, total);
      }
    } else chunks.push(new Uint8Array(await res.arrayBuffer()));
  } catch (e) {
    if (signal?.aborted) throw new YouTubeServiceError("Cancelled", "cancelled");
    throw new YouTubeServiceError(e instanceof Error ? `The download stopped early: ${e.message}` : "The download stopped early.", "rejected");
  }
  if (total && loaded < total) throw new YouTubeServiceError("The download stopped before the whole video arrived. Try again.", "rejected");
  return { file: new File(chunks as BlobPart[], `${title}.mp4`, { type: "video/mp4" }), title, duration };
}
