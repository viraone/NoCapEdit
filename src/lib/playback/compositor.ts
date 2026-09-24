/**
 * Compositor: draws a complete frame (video layer with native or GLSL
 * transitions, then stickers, text and captions) into any 2D context, in
 * frame coordinates. Shared by the live preview and the offline frame capture
 * used by the export pipeline, so both produce identical pixels.
 */
import type { VideoProject } from "@/lib/models/project";
import { drawOverlayLayer, type ElementRect, type Frame } from "@/lib/captions/renderer";
import { computePlacement } from "@/lib/models/placement";
import { layoutClips, locateFrame, toSourceTime, type ClipLayout } from "@/lib/models/timeline";
import { getSharedGlRenderer, isGlTransition } from "@/lib/gl/transitions";
import type { EngineFrame } from "./engine";
import { drawVideoFrame } from "./draw";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CompositeOptions {
  includeCaptions?: boolean;
  includeOverlays?: boolean;
  images: (assetId: string) => CanvasImageSource | undefined;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext("2d")! };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

export class Compositor {
  private scratch: { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx }[] | null = null;
  frame: Frame;

  constructor(frame: Frame) {
    this.frame = frame;
  }

  setFrame(frame: Frame) {
    if (frame.width !== this.frame.width || frame.height !== this.frame.height) {
      this.frame = frame;
      this.scratch = null;
    }
  }

  private scratchCanvases() {
    if (!this.scratch) this.scratch = [makeCanvas(this.frame.width, this.frame.height), makeCanvas(this.frame.width, this.frame.height)];
    return this.scratch;
  }

  /** Draws the video layer; GLSL transitions render through WebGL when available. */
  drawVideo(ctx: Ctx, f: EngineFrame) {
    if (f.secondary && f.primary && isGlTransition(f.transition)) {
      const gl = getSharedGlRenderer(this.frame.width, this.frame.height);
      if (gl) {
        const [a, b] = this.scratchCanvases();
        drawVideoFrame(a.ctx, this.frame, { ...f, primary: f.secondary, secondary: null, progress: 0, transition: "none" });
        drawVideoFrame(b.ctx, this.frame, { ...f, secondary: null, progress: 0, transition: "none" });
        try {
          const out = gl.render(f.transition, a.canvas as TexImageSource, b.canvas as TexImageSource, f.progress);
          ctx.drawImage(out, 0, 0, this.frame.width, this.frame.height);
          return;
        } catch {
          /* fall through to the 2D crossfade */
        }
      }
      drawVideoFrame(ctx, this.frame, { ...f, transition: "fade" });
      return;
    }
    drawVideoFrame(ctx, this.frame, f);
  }

  /** Full composite for one frame. Returns element rectangles for hit-testing. */
  composite(ctx: Ctx, project: VideoProject, f: EngineFrame, opts: CompositeOptions): ElementRect[] {
    this.drawVideo(ctx, f);
    return drawOverlayLayer(ctx, project, f.time, this.frame, {
      images: opts.images,
      includeCaptions: opts.includeCaptions,
      includeOverlays: opts.includeOverlays,
    });
  }
}

// ---------------------------------------------------------------------------
// Offline, frame-accurate capture (used for export segments that need the
// compositor: GPU transitions, tracked overlays, animated reframing).
// ---------------------------------------------------------------------------

export interface CaptureOptions {
  project: VideoProject;
  /** Object URLs per asset id. */
  urls: Record<string, string>;
  frame: Frame;
  fps: number;
  from: number;
  to: number;
  images: (assetId: string) => CanvasImageSource | undefined;
  includeCaptions?: boolean;
  includeOverlays?: boolean;
  format?: "image/jpeg" | "image/png";
  quality?: number;
  onFrame: (data: Uint8Array, index: number, time: number) => Promise<void>;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.0005 && video.readyState >= 2) return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    setTimeout(finish, 2000);
    video.currentTime = time;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.onloadeddata = () => resolve(v);
    v.onerror = () => reject(new Error("Could not load a clip for frame capture"));
    v.src = url;
  });
}

async function encode(canvas: HTMLCanvasElement | OffscreenCanvas, type: string, quality: number): Promise<Uint8Array> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type, quality })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Frame encode failed"))), type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Renders every frame in [from, to) at `fps` and hands the encoded image to `onFrame`. */
export async function captureFrames(o: CaptureOptions): Promise<number> {
  const layouts = layoutClips(o.project.clips);
  const videos = new Map<string, HTMLVideoElement>();
  const compositor = new Compositor(o.frame);
  const { canvas, ctx } = makeCanvas(o.frame.width, o.frame.height);
  const format = o.format ?? "image/jpeg";
  const quality = o.quality ?? 0.92;
  const total = Math.max(0, Math.round((o.to - o.from) * o.fps));
  try {
    for (const l of layouts) {
      if (l.end <= o.from || l.start >= o.to) continue;
      const url = o.urls[l.clip.assetId];
      if (!url) throw new Error("A clip's media is missing");
      videos.set(l.clip.id, await loadVideo(url));
    }
    const videoFor = (l: ClipLayout) => videos.get(l.clip.id) ?? null;
    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new DOMException("Capture cancelled", "AbortError");
      const time = o.from + i / o.fps;
      const loc = locateFrame(layouts, Math.min(time, o.to - 1e-4));
      let f: EngineFrame = { time, primary: null, secondary: null, progress: 0, transition: "none" };
      if (loc) {
        const pv = videoFor(loc.primary);
        const sv = loc.secondary ? videoFor(loc.secondary) : null;
        if (pv) await seekTo(pv, toSourceTime(loc.primary, time));
        if (sv && loc.secondary) await seekTo(sv, toSourceTime(loc.secondary, time));
        f = {
          time,
          primary: pv ? { video: pv, layout: loc.primary } : null,
          secondary: sv && loc.secondary ? { video: sv, layout: loc.secondary } : null,
          progress: loc.progress,
          transition: loc.secondary ? loc.secondary.clip.transition.type : "none",
        };
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      compositor.composite(ctx, o.project, f, { images: o.images, includeCaptions: o.includeCaptions, includeOverlays: o.includeOverlays });
      await o.onFrame(await encode(canvas, format, quality), i, time);
      o.onProgress?.(i + 1, total);
    }
    return total;
  } finally {
    for (const v of videos.values()) {
      v.removeAttribute("src");
      v.load();
    }
  }
}

/** True when a project segment needs the compositor (something xfade cannot do). */
export function needsCompositor(project: VideoProject, from: number, to: number): boolean {
  const layouts = layoutClips(project.clips);
  for (const l of layouts) {
    if (l.transitionOut > 0 && isGlTransition(l.clip.transition.type)) {
      const tStart = l.end - l.transitionOut;
      if (tStart < to && l.end > from) return true;
    }
    const clip = l.clip as { reframe?: unknown };
    if (clip.reframe && l.start < to && l.end > from) return true;
  }
  for (const ov of project.overlays as Array<{ start: number; end: number; track?: unknown }>) {
    if (ov.track && ov.start < to && ov.end > from) return true;
  }
  return false;
}

export { computePlacement };
