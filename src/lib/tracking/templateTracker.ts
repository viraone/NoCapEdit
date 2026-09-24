/**
 * Motion tracking without any ML dependency: normalised cross-correlation
 * template matching on a downscaled grayscale copy of the composed frame.
 * The user picks a point (the overlay's centre); the tracker follows the
 * patch around it through the clip and returns keyframes in project time,
 * which `overlayCenter()` interpolates for the preview and the export.
 */
import type { Keyframe } from "@/lib/models/project";
import type { Frame } from "@/lib/captions/renderer";
import { computePlacement } from "@/lib/models/placement";
import { clipPanAt } from "@/lib/models/project";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";
import type { Clip } from "@/lib/models/project";

export interface TrackOptions {
  clips: Clip[];
  urls: Record<string, string>;
  frame: Frame;
  /** Project time range to track. */
  from: number;
  to: number;
  /** Initial point as fractions of the frame. */
  point: { x: number; y: number };
  /** Analysis rate, frames per second. */
  fps?: number;
  /** Template size as a fraction of the analysis width. */
  patch?: number;
  onProgress?: (message: string, progress: number) => void;
  signal?: AbortSignal;
}

const ANALYSIS_WIDTH = 320;

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    if (Math.abs(video.currentTime - time) < 0.001 && video.readyState >= 2) return resolve();
    video.addEventListener("seeked", finish);
    setTimeout(finish, 1500);
    video.currentTime = time;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Could not load a clip for tracking"));
    v.src = url;
  });
}

function grayscale(ctx: CanvasRenderingContext2D, w: number, h: number): Float32Array {
  const { data } = ctx.getImageData(0, 0, w, h);
  const out = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i += 4, j++) out[j] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
  return out;
}

function extract(img: Float32Array, w: number, h: number, cx: number, cy: number, half: number): Float32Array | null {
  const size = half * 2 + 1;
  if (cx - half < 0 || cy - half < 0 || cx + half >= w || cy + half >= h) return null;
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[y * size + x] = img[(cy - half + y) * w + (cx - half + x)];
  return out;
}

/** Normalised cross-correlation between two equally sized patches. */
export function ncc(a: Float32Array, b: Float32Array): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < a.length; i++) {
    ma += a[i];
    mb += b[i];
  }
  ma /= a.length;
  mb /= b.length;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-6 ? 0 : num / den;
}

/** Finds the best match of `template` around (cx, cy) within ±search pixels. */
export function matchTemplate(img: Float32Array, w: number, h: number, template: Float32Array, half: number, cx: number, cy: number, search: number): { x: number; y: number; score: number } {
  let best = { x: cx, y: cy, score: -Infinity };
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      const p = extract(img, w, h, cx + dx, cy + dy, half);
      if (!p) continue;
      const s = ncc(template, p);
      if (s > best.score) best = { x: cx + dx, y: cy + dy, score: s };
    }
  }
  return best;
}

/** Tracks a point through the composed video and returns project-time keyframes. */
export async function trackPoint(o: TrackOptions): Promise<Keyframe[]> {
  const layouts = layoutClips(o.clips);
  const aw = ANALYSIS_WIDTH;
  const ah = Math.max(16, Math.round((o.frame.height / o.frame.width) * aw));
  const canvas = document.createElement("canvas");
  canvas.width = aw;
  canvas.height = ah;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const videos = new Map<string, HTMLVideoElement>();
  const fps = o.fps ?? 10;
  const half = Math.max(4, Math.round(((o.patch ?? 0.1) * aw) / 2));
  const search = Math.max(6, Math.round(aw * 0.08));
  const total = Math.max(1, Math.ceil((o.to - o.from) * fps));
  const keyframes: Keyframe[] = [];

  const draw = async (time: number) => {
    const loc = locateFrame(layouts, time);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, aw, ah);
    if (!loc) return;
    const layout = loc.primary;
    let v = videos.get(layout.clip.id);
    if (!v) {
      const url = o.urls[layout.clip.assetId];
      if (!url) return;
      v = await loadVideo(url);
      videos.set(layout.clip.id, v);
    }
    const st = toSourceTime(layout, time);
    await seek(v, st);
    const p = computePlacement({ width: v.videoWidth || layout.clip.width, height: v.videoHeight || layout.clip.height }, { zoom: layout.clip.zoom, pan: clipPanAt(layout.clip, st) }, o.frame);
    const s = aw / o.frame.width;
    ctx.drawImage(v, p.dx * s, p.dy * s, p.dw * s, p.dh * s);
  };

  try {
    let cx = Math.round(o.point.x * aw);
    let cy = Math.round(o.point.y * ah);
    await draw(o.from);
    let img = grayscale(ctx, aw, ah);
    const template = extract(img, aw, ah, cx, cy, half);
    if (!template) throw new Error("Move the element away from the frame edge before tracking.");
    keyframes.push({ t: o.from, x: cx / aw, y: cy / ah });
    for (let i = 1; i <= total; i++) {
      if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const time = Math.min(o.to, o.from + i / fps);
      await draw(time);
      img = grayscale(ctx, aw, ah);
      const m = matchTemplate(img, aw, ah, template, half, cx, cy, search);
      if (m.score > 0.35) {
        cx = m.x;
        cy = m.y;
        if (m.score > 0.6) {
          const fresh = extract(img, aw, ah, cx, cy, half);
          if (fresh) for (let k = 0; k < template.length; k++) template[k] = template[k] * 0.85 + fresh[k] * 0.15;
        }
      }
      keyframes.push({ t: time, x: cx / aw, y: cy / ah });
      o.onProgress?.(`Tracking ${(time - o.from).toFixed(1)}s / ${(o.to - o.from).toFixed(1)}s`, i / total);
    }
  } finally {
    for (const v of videos.values()) {
      v.removeAttribute("src");
      v.load();
    }
  }
  return keyframes;
}
