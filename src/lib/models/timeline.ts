import type { Clip } from "./project";

/** Output duration of a clip after trimming and speed. */
export function clipOutputDuration(clip: Clip): number {
  return Math.max(0, (clip.outPoint - clip.inPoint) / clip.speed);
}

/** Effective transition length between two clips (clamped to half of each clip). */
export function transitionDuration(a: Clip, b: Clip): number {
  if (a.transition.type === "none" || a.transition.duration <= 0) return 0;
  return Math.max(0, Math.min(a.transition.duration, clipOutputDuration(a) / 2, clipOutputDuration(b) / 2));
}

export interface ClipLayout {
  clip: Clip;
  index: number;
  /** Project time at which this clip starts (including any transition overlap). */
  start: number;
  end: number;
  duration: number;
  /** Overlap with the previous clip at the head of this clip. */
  transitionIn: number;
  /** Overlap with the next clip at the tail of this clip. */
  transitionOut: number;
}

export function layoutClips(clips: Clip[]): ClipLayout[] {
  const layouts: ClipLayout[] = [];
  let t = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const duration = clipOutputDuration(clip);
    const transitionOut = i < clips.length - 1 ? transitionDuration(clip, clips[i + 1]) : 0;
    const transitionIn = i > 0 ? layouts[i - 1].transitionOut : 0;
    const start = t;
    const end = start + duration;
    layouts.push({ clip, index: i, start, end, duration, transitionIn, transitionOut });
    t = end - transitionOut;
  }
  return layouts;
}

export function projectDuration(clips: Clip[]): number {
  const layouts = layoutClips(clips);
  return layouts.length ? layouts[layouts.length - 1].end : 0;
}

export interface FrameLocation {
  primary: ClipLayout;
  /** Outgoing clip during a transition. */
  secondary: ClipLayout | null;
  /** 0..1 progress through the transition, when one is active. */
  progress: number;
}

/** Which clip(s) are visible at project time t. */
export function locateFrame(layouts: ClipLayout[], t: number): FrameLocation | null {
  if (!layouts.length) return null;
  let primary = layouts[0];
  for (const l of layouts) {
    if (t >= l.start) primary = l;
    else break;
  }
  if (primary.transitionIn > 0 && t < primary.start + primary.transitionIn && primary.index > 0) {
    const secondary = layouts[primary.index - 1];
    const progress = (t - primary.start) / primary.transitionIn;
    return { primary, secondary, progress: Math.min(1, Math.max(0, progress)) };
  }
  return { primary, secondary: null, progress: 0 };
}

/** Project time -> source (file) time inside the clip. */
export function toSourceTime(layout: ClipLayout, t: number): number {
  const { clip } = layout;
  const s = clip.inPoint + (t - layout.start) * clip.speed;
  return Math.min(clip.outPoint, Math.max(clip.inPoint, s));
}

/** Source (file) time -> project time. */
export function toProjectTime(layout: ClipLayout, sourceTime: number): number {
  return layout.start + (sourceTime - layout.clip.inPoint) / layout.clip.speed;
}

/** Finds the layout that owns a clip id. */
export function findLayout(layouts: ClipLayout[], clipId: string): ClipLayout | undefined {
  return layouts.find((l) => l.clip.id === clipId);
}
