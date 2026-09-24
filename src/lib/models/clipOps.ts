/** Clip edits shared by the Clips panel, Trim panel and timeline (operate on a draft project). */
import type { VideoProject } from "./project";
import { layoutClips, locateFrame, toSourceTime } from "./timeline";
import { uid } from "@/lib/utils/id";

export function moveClip(p: VideoProject, id: string, dir: -1 | 1): boolean {
  const i = p.clips.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= p.clips.length) return false;
  [p.clips[i], p.clips[j]] = [p.clips[j], p.clips[i]];
  return true;
}

export function removeClip(p: VideoProject, id: string) {
  p.clips = p.clips.filter((c) => c.id !== id);
}

export function duplicateClip(p: VideoProject, id: string): string | null {
  const i = p.clips.findIndex((c) => c.id === id);
  if (i < 0) return null;
  const copy = { ...structuredClone(p.clips[i]), id: uid("clip") };
  p.clips.splice(i + 1, 0, copy);
  return copy.id;
}

/** Splits the clip under `time` into two; returns the new (second) clip id. */
export function splitClipAt(p: VideoProject, time: number): string | null {
  const loc = locateFrame(layoutClips(p.clips), time);
  if (!loc) return null;
  const layout = loc.primary;
  if (time <= layout.start + 0.1 || time >= layout.end - 0.1) return null;
  const s = toSourceTime(layout, time);
  const i = p.clips.findIndex((c) => c.id === layout.clip.id);
  if (i < 0) return null;
  const a = p.clips[i];
  const b = { ...structuredClone(a), id: uid("clip"), inPoint: s };
  a.outPoint = s;
  a.transition = { type: "none", duration: a.transition.duration };
  p.clips.splice(i + 1, 0, b);
  return b.id;
}

/** Removes everything before the playhead from the clip that contains it. */
export function cutBefore(p: VideoProject, time: number): boolean {
  const loc = locateFrame(layoutClips(p.clips), time);
  if (!loc) return false;
  const c = p.clips.find((c) => c.id === loc.primary.clip.id);
  if (!c) return false;
  const s = toSourceTime(loc.primary, time);
  if (s >= c.outPoint - 0.1) return false;
  c.inPoint = s;
  return true;
}

/** Removes everything after the playhead from the clip that contains it. */
export function cutAfter(p: VideoProject, time: number): boolean {
  const loc = locateFrame(layoutClips(p.clips), time);
  if (!loc) return false;
  const c = p.clips.find((c) => c.id === loc.primary.clip.id);
  if (!c) return false;
  const s = toSourceTime(loc.primary, time);
  if (s <= c.inPoint + 0.1) return false;
  c.outPoint = s;
  return true;
}

/** Zoom at which the whole source is visible inside the frame ("Fit"). */
export function fitZoom(source: { width: number; height: number }, frame: { width: number; height: number }): number {
  const cover = Math.max(frame.width / source.width, frame.height / source.height);
  const contain = Math.min(frame.width / source.width, frame.height / source.height);
  return Math.max(0.5, Math.min(4, contain / cover));
}
