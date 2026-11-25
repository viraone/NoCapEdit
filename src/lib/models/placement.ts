import type { Frame } from "@/lib/captions/renderer";

export interface Placement {
  scale: number;
  dw: number;
  dh: number;
  dx: number;
  dy: number;
}

/** How far the picture may be panned each way, as a fraction of the frame, before one of its edges crosses the frame's edge. When the picture is larger than the frame this keeps the frame covered; when it is smaller (zoomed out) it keeps the picture inside the frame. */
export function panLimit(source: { width: number; height: number }, zoom: number, frame: Frame): { x: number; y: number } {
  const sw = Math.max(1, source.width);
  const sh = Math.max(1, source.height);
  const scale = Math.max(frame.width / sw, frame.height / sh) * zoom;
  return {
    x: Math.abs(sw * scale - frame.width) / 2 / frame.width,
    y: Math.abs(sh * scale - frame.height) / 2 / frame.height,
  };
}

/** `pan` held inside panLimit. */
export function clampPan(pan: { x: number; y: number }, source: { width: number; height: number }, zoom: number, frame: Frame): { x: number; y: number } {
  const lim = panLimit(source, zoom, frame);
  return { x: Math.min(lim.x, Math.max(-lim.x, pan.x)), y: Math.min(lim.y, Math.max(-lim.y, pan.y)) };
}

/**
 * The zoom a drag needs: on an axis where the picture only just covers the frame at zoom 1 there is no room to
 * move, so the picture is zoomed in just enough for a pan of `want`. Never below `zoom`, never above `max` unless
 * `zoom` already is, and unchanged for a zoomed-out picture (zoom below 1) or an axis that has room of its own.
 */
export function zoomForPan(want: { x: number; y: number }, source: { width: number; height: number }, zoom: number, frame: Frame, max: number): number {
  if (zoom < 1) return zoom;
  const sw = Math.max(1, source.width);
  const sh = Math.max(1, source.height);
  const base = Math.max(frame.width / sw, frame.height / sh);
  let need = zoom;
  if (sw * base - frame.width < 0.5) need = Math.max(need, 1 + 2 * Math.abs(want.x));
  if (sh * base - frame.height < 0.5) need = Math.max(need, 1 + 2 * Math.abs(want.y));
  return Math.min(Math.ceil(need * 1000 - 1e-6) / 1000, Math.max(zoom, max));
}

/**
 * Where a clip's source image lands inside the frame. The source is "cover"
 * fitted, then zoomed around the centre and panned by a fraction of the frame.
 * Shared by the preview canvas and the ffmpeg export so both match exactly.
 * The pan is held inside panLimit, so no empty space shows that the zoom does not force.
 */
export function computePlacement(
  source: { width: number; height: number },
  clip: { zoom: number; pan: { x: number; y: number } },
  frame: Frame,
): Placement {
  const sw = Math.max(1, source.width);
  const sh = Math.max(1, source.height);
  const base = Math.max(frame.width / sw, frame.height / sh);
  const scale = base * clip.zoom;
  const dw = sw * scale;
  const dh = sh * scale;
  const pan = clampPan(clip.pan, source, clip.zoom, frame);
  const dx = (frame.width - dw) / 2 + pan.x * frame.width;
  const dy = (frame.height - dh) / 2 + pan.y * frame.height;
  return { scale, dw, dh, dx, dy };
}
