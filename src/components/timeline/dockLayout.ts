import { clamp } from "@/lib/utils/math";

/** Fixed lane heights of the timeline dock (px). */
export const RULER_H = 24;
export const CUE_H = 34;
export const MUSIC_H = 28;
/** Transport bar (44) plus the "Timeline" header row (30). */
export const DOCK_CHROME_H = 44 + 30;

/** The video lane is the only lane that grows, so its range sets the dock's range. */
export const VIDEO_MIN_H = 48;
export const VIDEO_DEFAULT_H = 76;
/** Thumbnail sprites are 72 px tall; past ~3× they turn to mush. */
export const VIDEO_MAX_H = 220;

const FIXED_H = DOCK_CHROME_H + RULER_H + CUE_H + MUSIC_H;
export const DOCK_MIN_H = FIXED_H + VIDEO_MIN_H;
export const DOCK_DEFAULT_H = FIXED_H + VIDEO_DEFAULT_H;
export const DOCK_MAX_H = FIXED_H + VIDEO_MAX_H;

/** Window height the preview keeps for itself: the dock never grows past the window minus this. */
export const STAGE_MIN_H = 320;

/** Clamps a requested dock height to the lane limits and, when the window height is given, to what it can spare. */
export function clampDockHeight(h: number, viewportH = Infinity): number {
  if (!Number.isFinite(h)) return DOCK_DEFAULT_H;
  const max = Math.max(DOCK_MIN_H, Math.min(DOCK_MAX_H, viewportH - STAGE_MIN_H));
  return clamp(Math.round(h), DOCK_MIN_H, max);
}

/** Height of the video lane for a dock of height `dockH`. */
export function videoLaneHeight(dockH: number): number {
  return clamp(dockH - FIXED_H, VIDEO_MIN_H, VIDEO_MAX_H);
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
