import type { Frame } from "@/lib/captions/renderer";

export interface Placement {
  scale: number;
  dw: number;
  dh: number;
  dx: number;
  dy: number;
}

/**
 * Where a clip's source image lands inside the frame. The source is "cover"
 * fitted, then zoomed around the centre and panned by a fraction of the frame.
 * Shared by the preview canvas and the ffmpeg export so both match exactly.
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
  const dx = (frame.width - dw) / 2 + clip.pan.x * frame.width;
  const dy = (frame.height - dh) / 2 + clip.pan.y * frame.height;
  return { scale, dw, dh, dx, dy };
}
