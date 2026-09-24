import type { Frame } from "@/lib/captions/renderer";
import { clipPanAt, isNeutralLook, type TransitionType } from "@/lib/models/project";
import { getSharedGrader } from "@/lib/gl/colorGrade";
import { getLutSync } from "@/lib/color/cube";
import { getMatteSync } from "@/lib/matte/matte";

let maskCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
let maskKey = "";
let cutCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

function mkCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Applies the nearest matte mask to a frame; returns the cut-out canvas or null. */
function applyMatte(source: CanvasImageSource, sw: number, sh: number, clip: { matte?: { assetId: string; inPoint: number; fps: number; count: number; width: number; height: number } | null }, sourceTime: number): CanvasImageSource | null {
  const m = clip.matte;
  if (!m) return null;
  const frames = getMatteSync(m.assetId);
  if (!frames) return null;
  const idx = Math.max(0, Math.min(frames.count - 1, Math.round((sourceTime - m.inPoint) * frames.fps)));
  const key = `${m.assetId}:${idx}`;
  if (!maskCanvas || maskCanvas.width !== frames.width || maskCanvas.height !== frames.height) {
    maskCanvas = mkCanvas(frames.width, frames.height);
    maskKey = "";
  }
  if (maskKey !== key) {
    const mctx = maskCanvas.getContext("2d") as CanvasRenderingContext2D;
    const img = mctx.createImageData(frames.width, frames.height);
    const off = idx * frames.width * frames.height;
    for (let i = 0, j = 3; i < frames.width * frames.height; i++, j += 4) img.data[j] = frames.masks[off + i];
    mctx.putImageData(img, 0, 0);
    maskKey = key;
  }
  if (!cutCanvas || cutCanvas.width !== sw || cutCanvas.height !== sh) cutCanvas = mkCanvas(sw, sh);
  const cctx = cutCanvas.getContext("2d") as CanvasRenderingContext2D;
  cctx.globalCompositeOperation = "source-over";
  cctx.clearRect(0, 0, sw, sh);
  cctx.drawImage(source, 0, 0, sw, sh);
  cctx.globalCompositeOperation = "destination-in";
  cctx.drawImage(maskCanvas, 0, 0, sw, sh);
  cctx.globalCompositeOperation = "source-over";
  return cutCanvas as CanvasImageSource;
}
import { computePlacement } from "@/lib/models/placement";
import type { ClipLayout } from "@/lib/models/timeline";
import type { EngineFrame } from "./engine";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawClip(ctx: Ctx, video: HTMLVideoElement, layout: ClipLayout, frame: Frame, offsetX = 0, offsetY = 0) {
  const vw = video.videoWidth || layout.clip.width;
  const vh = video.videoHeight || layout.clip.height;
  if (!vw || !vh || video.readyState < 2) return;
  const p = computePlacement({ width: vw, height: vh }, { zoom: layout.clip.zoom, pan: clipPanAt(layout.clip, video.currentTime) }, frame);
  let source: CanvasImageSource = video;
  let sw = vw;
  let sh = vh;
  const look = layout.clip.look;
  if (!isNeutralLook(look)) {
    const grader = getSharedGrader();
    if (grader) {
      const lut = look?.lutAssetId ? getLutSync(look.lutAssetId) : null;
      const scale = Math.min(1, 1920 / Math.max(vw, vh));
      sw = Math.max(2, Math.round(vw * scale));
      sh = Math.max(2, Math.round(vh * scale));
      try {
        source = grader.render(video, sw, sh, { brightness: look!.brightness, contrast: look!.contrast, saturation: look!.saturation, lut });
      } catch {
        source = video;
        sw = vw;
        sh = vh;
      }
    }
  }
  if (layout.clip.matte) {
    const cut = applyMatte(source, sw, sh, layout.clip, video.currentTime);
    if (cut) source = cut;
  }
  try {
    ctx.drawImage(source, 0, 0, sw, sh, p.dx + offsetX, p.dy + offsetY, p.dw, p.dh);
  } catch {
    /* frame not ready */
  }
}

/** Paints the video layer (including transitions) for one frame. `behind` draws between the background and the clips. */
export function drawVideoFrame(ctx: Ctx, frame: Frame, f: EngineFrame, behind?: (ctx: Ctx) => void) {
  ctx.fillStyle = f.primary?.layout.clip.background ?? "#000";
  ctx.fillRect(0, 0, frame.width, frame.height);
  behind?.(ctx);
  if (!f.primary) return;
  if (!f.secondary) {
    drawClip(ctx, f.primary.video, f.primary.layout, frame);
    return;
  }
  const p = f.progress;
  const W = frame.width;
  const H = frame.height;
  const out = f.secondary;
  const inc = f.primary;
  const t: TransitionType = f.transition;
  switch (t) {
    case "fadeblack":
    case "fadewhite": {
      const color = t === "fadeblack" ? "#000" : "#fff";
      if (p < 0.5) {
        drawClip(ctx, out.video, out.layout, frame);
        ctx.globalAlpha = p * 2;
      } else {
        drawClip(ctx, inc.video, inc.layout, frame);
        ctx.globalAlpha = (1 - p) * 2;
      }
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
      return;
    }
    case "wipeleft":
    case "wiperight":
    case "wipeup":
    case "wipedown": {
      drawClip(ctx, out.video, out.layout, frame);
      ctx.save();
      ctx.beginPath();
      if (t === "wipeleft") ctx.rect(W * (1 - p), 0, W * p, H);
      else if (t === "wiperight") ctx.rect(0, 0, W * p, H);
      else if (t === "wipeup") ctx.rect(0, H * (1 - p), W, H * p);
      else ctx.rect(0, 0, W, H * p);
      ctx.clip();
      drawClip(ctx, inc.video, inc.layout, frame);
      ctx.restore();
      return;
    }
    case "slideleft":
    case "slideright":
    case "slideup":
    case "slidedown": {
      let ox = 0;
      let oy = 0;
      if (t === "slideleft") ox = -W * p;
      if (t === "slideright") ox = W * p;
      if (t === "slideup") oy = -H * p;
      if (t === "slidedown") oy = H * p;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      drawClip(ctx, out.video, out.layout, frame, ox, oy);
      const ix = t === "slideleft" ? W + ox : t === "slideright" ? -W + ox : 0;
      const iy = t === "slideup" ? H + oy : t === "slidedown" ? -H + oy : 0;
      drawClip(ctx, inc.video, inc.layout, frame, ix, iy);
      ctx.restore();
      return;
    }
    default: {
      drawClip(ctx, out.video, out.layout, frame);
      ctx.globalAlpha = p;
      drawClip(ctx, inc.video, inc.layout, frame);
      ctx.globalAlpha = 1;
    }
  }
}
