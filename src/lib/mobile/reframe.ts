/**
 * Reframing for the mobile editor: choose an output shape (9:16 for Reels,
 * 1:1, …) and position the video inside it by dragging and pinching. One
 * set of maths drives both the live preview and the export so what you
 * place is exactly what gets rendered.
 *
 * The crop is described by a focus point (fx, fy ∈ 0…1: where the crop
 * window sits inside the slack the source leaves around it) and a zoom
 * (1 = the largest crop of that shape that fits, "cover").
 */

export type FrameFormat = "original" | "9:16" | "4:5" | "1:1" | "16:9";

export interface Reframe {
  format: FrameFormat;
  fx: number;
  fy: number;
  zoom: number;
}

export const DEFAULT_REFRAME: Reframe = { format: "original", fx: 0.5, fy: 0.5, zoom: 1 };
export const MAX_ZOOM = 4;

export const FRAME_FORMATS: { id: FrameFormat; label: string; hint: string; ratio: number | null }[] = [
  { id: "original", label: "Original", hint: "As shot", ratio: null },
  { id: "9:16", label: "9:16", hint: "Reels · TikTok", ratio: 9 / 16 },
  { id: "4:5", label: "4:5", hint: "Feed post", ratio: 4 / 5 },
  { id: "1:1", label: "1:1", hint: "Square", ratio: 1 },
  { id: "16:9", label: "16:9", hint: "YouTube", ratio: 16 / 9 },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Width ÷ height of the output frame. */
export function aspectOf(format: FrameFormat, sourceWidth: number, sourceHeight: number): number {
  const ratio = FRAME_FORMATS.find((f) => f.id === format)?.ratio;
  return ratio ?? sourceWidth / Math.max(1, sourceHeight);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The source-pixel rectangle that fills the output frame. */
export function cropRect(sourceWidth: number, sourceHeight: number, r: Reframe): Rect {
  const aspect = aspectOf(r.format, sourceWidth, sourceHeight);
  const coverW = Math.min(sourceWidth, sourceHeight * aspect);
  const coverH = coverW / aspect;
  const zoom = clamp(r.zoom, 1, MAX_ZOOM);
  const w = coverW / zoom;
  const h = coverH / zoom;
  return {
    x: (sourceWidth - w) * clamp(r.fx, 0, 1),
    y: (sourceHeight - h) * clamp(r.fy, 0, 1),
    w,
    h,
  };
}

/**
 * Output pixel size. "Original" never upscales (long edge capped). A
 * cropped shape may upscale the crop up to 2× so a 1080p landscape clip
 * still makes a full 1080×1920 reel; it is capped at the usual social
 * sizes (long edge `maxEdge`, short edge 1080).
 */
export function outputFrame(sourceWidth: number, sourceHeight: number, r: Reframe, maxEdge = 1920): { width: number; height: number } {
  if (r.format === "original") {
    const scale = Math.min(1, maxEdge / Math.max(sourceWidth, sourceHeight));
    return { width: even(sourceWidth * scale), height: even(sourceHeight * scale) };
  }
  const aspect = aspectOf(r.format, sourceWidth, sourceHeight);
  const coverW = Math.min(sourceWidth, sourceHeight * aspect);
  const coverH = coverW / aspect;
  const shortCap = Math.round((maxEdge * 9) / 16); // 1080 for a 1920 long edge
  const scale = Math.min(2, maxEdge / Math.max(coverW, coverH), shortCap / Math.min(coverW, coverH));
  const height = even(coverH * scale);
  return { width: even(height * aspect), height };
}

/**
 * Where to draw the *whole* source frame on an output canvas so that the
 * crop rectangle exactly fills it (the canvas clips the rest). Used
 * instead of drawImage's source-rectangle form: WebKit ignores the source
 * rectangle when the image is a decoded VideoFrame and squeezes the entire
 * picture into the destination.
 */
export function placeWholeFrame(sourceWidth: number, sourceHeight: number, crop: Rect, outWidth: number, outHeight: number): { dx: number; dy: number; dw: number; dh: number } {
  const scaleX = outWidth / crop.w;
  const scaleY = outHeight / crop.h;
  return { dx: -crop.x * scaleX, dy: -crop.y * scaleY, dw: sourceWidth * scaleX, dh: sourceHeight * scaleY };
}

/** Moves the crop window by a drag expressed in *source* pixels (the video
 * follows the finger, so the window moves the opposite way). */
export function panBy(sourceWidth: number, sourceHeight: number, r: Reframe, dxSource: number, dySource: number): Reframe {
  const rect = cropRect(sourceWidth, sourceHeight, r);
  const slackX = sourceWidth - rect.w;
  const slackY = sourceHeight - rect.h;
  const x = clamp(rect.x - dxSource, 0, slackX);
  const y = clamp(rect.y - dySource, 0, slackY);
  return { ...r, fx: slackX > 0.5 ? x / slackX : 0.5, fy: slackY > 0.5 ? y / slackY : 0.5 };
}

export function withZoom(r: Reframe, zoom: number): Reframe {
  return { ...r, zoom: clamp(zoom, 1, MAX_ZOOM) };
}
