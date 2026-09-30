import { clamp } from "@/lib/utils/math";

/** Fixed lane heights of the timeline dock (px). */
export const RULER_H = 24;
export const CUE_H = 34;
export const MUSIC_H = 28;
/** Transport bar (44) plus the "Timeline" header row (30). */
export const DOCK_CHROME_H = 44 + 30;

/** The video lane and the audio lane under it (same height) are the lanes that grow. */
export const VIDEO_MIN_H = 48;
export const VIDEO_DEFAULT_H = 76;
/** Thumbnail sprites are 72 px tall; past ~3× they turn to mush. */
export const VIDEO_MAX_H = 220;

const FIXED_H = DOCK_CHROME_H + RULER_H + CUE_H + MUSIC_H;
/** Video lane plus the equally tall audio lane. */
const GROWING_LANES = 2;
export const DOCK_MIN_H = FIXED_H + VIDEO_MIN_H * GROWING_LANES;
export const DOCK_DEFAULT_H = FIXED_H + VIDEO_DEFAULT_H * GROWING_LANES;
export const DOCK_MAX_H = FIXED_H + VIDEO_MAX_H * GROWING_LANES;

/** Window height the preview keeps for itself: the dock never grows past the window minus this. */
export const STAGE_MIN_H = 380;

/**
 * Filmstrips and waveforms are drawn only for the part of a clip block that
 * is on screen, plus this much on either side (px), so a long clip never
 * needs a canvas the length of the whole timeline. Chrome loses any 2D
 * canvas wider than 65,535 device pixels for good (a 7-minute clip at the
 * default zoom on a 2x display: white block, broken-image glyph, and zooming
 * out does not bring it back), and even valid ones cost memory in proportion
 * to their length.
 */
export const STRIP_OVERSCAN = 600;

/** Widest a strip canvas may be in device pixels; the draw scale drops before this is crossed. */
export const MAX_STRIP_PX = 16384;

/** Part of a block to draw, in px from the block's left edge. */
export interface StripWindow {
  x0: number;
  x1: number;
}

/** The timeline range worth drawing for a viewport `viewW` px wide scrolled to `scrollX`. */
export function drawRange(scrollX: number, viewW: number, overscan = STRIP_OVERSCAN): { from: number; to: number } {
  return { from: Math.max(0, scrollX - overscan), to: scrollX + viewW + overscan };
}

/**
 * The part of a block that lies inside the drawn range of the timeline
 * (`view`, timeline px), on whole pixels. Empty (x1 <= x0) when the block is
 * off screen.
 */
export function visibleWindow(blockLeft: number, blockWidth: number, view: { from: number; to: number }): StripWindow {
  const w = Math.max(0, blockWidth);
  return { x0: clamp(Math.floor(view.from - blockLeft), 0, w), x1: clamp(Math.ceil(view.to - blockLeft), 0, w) };
}

/** Draw scale for a strip `cssWidth` px wide: the device pixel ratio capped at 2, lowered so the canvas stays under MAX_STRIP_PX. */
export function stripScale(cssWidth: number, devicePixelRatio: number): number {
  const dpr = Math.min(2, devicePixelRatio || 1);
  return cssWidth > 0 ? Math.min(dpr, MAX_STRIP_PX / cssWidth) : dpr;
}

/** Clamps a requested dock height to the lane limits and, when the window height is given, to what it can spare. */
export function clampDockHeight(h: number, viewportH = Infinity): number {
  if (!Number.isFinite(h)) return DOCK_DEFAULT_H;
  const max = Math.max(DOCK_MIN_H, Math.min(DOCK_MAX_H, viewportH - STAGE_MIN_H));
  return clamp(Math.round(h), DOCK_MIN_H, max);
}

/** Height of the video lane (and of the audio lane) for a dock of height `dockH`. */
export function videoLaneHeight(dockH: number): number {
  return clamp(Math.round((dockH - FIXED_H) / GROWING_LANES), VIDEO_MIN_H, VIDEO_MAX_H);
}

const STORAGE_KEY = "reelflow.timelineHeight";

/** The height the user last dragged the dock to, or the default; reads are guarded because storage may be unavailable. */
export function readStoredDockHeight(fallback = DOCK_DEFAULT_H): number {
  let v = fallback;
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY));
    if (stored > 0) v = stored;
  } catch {
    /* storage unavailable: keep the fallback */
  }
  // Always clamped against the live window (guarded for the static prerender).
  return clampDockHeight(v, typeof window === "undefined" ? undefined : window.innerHeight);
}

export function storeDockHeight(h: number): void {
  try {
    if (h === DOCK_DEFAULT_H) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, String(h));
  } catch {
    /* storage unavailable */
  }
}
