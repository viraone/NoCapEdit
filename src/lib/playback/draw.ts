import type { Frame } from "@/lib/captions/renderer";
import { clipPanAt, type TransitionType } from "@/lib/models/project";
import { computePlacement } from "@/lib/models/placement";
import type { ClipLayout } from "@/lib/models/timeline";
import type { EngineFrame } from "./engine";

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function drawClip(ctx: Ctx, video: HTMLVideoElement, layout: ClipLayout, frame: Frame, offsetX = 0, offsetY = 0) {
  const vw = video.videoWidth || layout.clip.width;
  const vh = video.videoHeight || layout.clip.height;
  if (!vw || !vh || video.readyState < 2) return;
  const p = computePlacement({ width: vw, height: vh }, { zoom: layout.clip.zoom, pan: clipPanAt(layout.clip, video.currentTime) }, frame);
  try {
    ctx.drawImage(video, 0, 0, vw, vh, p.dx + offsetX, p.dy + offsetY, p.dw, p.dh);
  } catch {
    /* frame not ready */
  }
}

/** Paints the video layer (including transitions) for one frame. */
export function drawVideoFrame(ctx: Ctx, frame: Frame, f: EngineFrame) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, frame.width, frame.height);
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
