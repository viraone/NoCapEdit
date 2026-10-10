/**
 * Turns a detected subject path into pan keyframes the way a camera operator
 * would move, rather than a filter that trails every wobble:
 *
 * - At a cut in the source (a different camera angle) the new shot starts
 *   framed; the camera never slides across a cut.
 * - While the face stays inside a comfort zone around the centre the camera
 *   holds still, so small head movements do not nudge the picture.
 * - When the face leaves that zone the camera glides to recentre it with a
 *   smooth ease in and out (a critically damped spring), capped at a speed a
 *   person could pan at, and follows while the subject keeps walking.
 *
 * Pure: no DOM, so it is unit-tested with synthetic paths.
 */
import type { Clip, Keyframe } from "@/lib/models/project";
import type { Frame } from "@/lib/captions/renderer";
import { computePlacement } from "@/lib/models/placement";
import { clamp } from "@/lib/utils/math";

export interface SubjectSample {
  /** Source time in seconds. */
  t: number;
  /** Subject centre as fractions of the source frame. */
  x: number;
  y: number;
  /** Shoulder (or face box) width as a fraction of the source width. */
  size: number;
  /** The picture changed shot between the previous sample and this one, at `cutAt` (source seconds). */
  cut?: boolean;
  cutAt?: number;
}

export interface CameraOptions {
  /** How far the face may drift from the centre, as a fraction of the frame size, before the camera moves. */
  deadZone?: number;
  /** Seconds a move takes to come to rest. */
  settle?: number;
  /** Fastest pan, in frame widths per second. */
  maxSpeed?: number;
  /** Steps per second of the simulated camera (also the keyframe rate while it moves). */
  fps?: number;
  /** A face jump bigger than this (fraction of the source width) between samples closer than `jumpWithin` is a cut the pixels missed. */
  jump?: number;
  jumpWithin?: number;
}

const DEFAULTS: Required<CameraOptions> = { deadZone: 0.07, settle: 1.2, maxSpeed: 0.8, fps: 12, jump: 0.15, jumpWithin: 0.6 };

/**
 * Converts subject positions into pan keyframes (source time) that keep the
 * subject centred, clamped so the frame stays fully covered by the source.
 */
export function subjectPathToPan(samples: SubjectSample[], clip: Clip, frame: Frame): Keyframe[] {
  const p = computePlacement({ width: clip.width, height: clip.height }, { zoom: clip.zoom, pan: { x: 0, y: 0 } }, frame);
  const maxPanX = Math.max(0, (p.dw - frame.width) / 2 / frame.width);
  const maxPanY = Math.max(0, (p.dh - frame.height) / 2 / frame.height);
  return samples.map((s) => {
    const sx = s.x * clip.width * p.scale;
    const sy = s.y * clip.height * p.scale;
    const dx = frame.width / 2 - sx;
    const dy = frame.height / 2 - sy;
    const panX = (dx - (frame.width - p.dw) / 2) / frame.width;
    const panY = (dy - (frame.height - p.dh) / 2) / frame.height;
    return { t: s.t, x: clamp(panX, -maxPanX, maxPanX), y: clamp(panY, -maxPanY, maxPanY) };
  });
}

const far = (a: SubjectSample, b: SubjectSample, d: number) => Math.abs(a.x - b.x) > d || Math.abs(a.y - b.y) > d;

/** Drops a lone sample that jumps away from both neighbours and back (a detector glitch, not a move). */
export function dropSpikes(samples: SubjectSample[], jump = DEFAULTS.jump): SubjectSample[] {
  return samples.filter((s, i) => {
    const a = samples[i - 1];
    const b = samples[i + 1];
    if (!a || !b || s.cut || b.cut) return true;
    return !(far(s, a, jump) && far(s, b, jump) && !far(a, b, jump));
  });
}

/** One continuous shot: its samples and when it starts (the cut, or the first sample). */
export interface Shot {
  start: number;
  samples: SubjectSample[];
}

/** Splits the path at cuts: ones the detector saw in the pixels, and face jumps too fast for a person. */
export function splitShots(samples: SubjectSample[], o: CameraOptions = {}): Shot[] {
  const { jump, jumpWithin } = { ...DEFAULTS, ...o };
  const shots: Shot[] = [];
  for (const s of samples) {
    const cur = shots[shots.length - 1];
    const prev = cur?.samples[cur.samples.length - 1];
    if (!cur) shots.push({ start: s.t, samples: [s] });
    else if (s.cut) shots.push({ start: s.cutAt ?? (prev.t + s.t) / 2, samples: [s] });
    else if (s.t - prev.t <= jumpWithin && far(s, prev, jump)) shots.push({ start: (prev.t + s.t) / 2, samples: [s] });
    else cur.samples.push(s);
  }
  return shots;
}

/** Median of three neighbours: takes the detector's jitter out of the path without lagging it. */
export function median3(samples: SubjectSample[]): SubjectSample[] {
  if (samples.length < 3) return samples;
  const med = (a: number, b: number, c: number) => Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  return samples.map((s, i) => {
    if (i === 0 || i === samples.length - 1) return s;
    const a = samples[i - 1];
    const b = samples[i + 1];
    return { ...s, x: med(a.x, s.x, b.x), y: med(a.y, s.y, b.y) };
  });
}

/** Linear interpolation of the ideal pan along a shot's samples (held flat before the first and after the last). */
function idealAt(pans: Keyframe[], t: number): { x: number; y: number } {
  if (t <= pans[0].t) return pans[0];
  const last = pans[pans.length - 1];
  if (t >= last.t) return last;
  let i = 1;
  while (pans[i].t < t) i++;
  const a = pans[i - 1];
  const b = pans[i];
  const f = (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** One axis of the camera: position, velocity and whether it is on the move. */
interface Axis {
  x: number;
  v: number;
  moving: boolean;
}

function stepAxis(ax: Axis, ideal: number, dt: number, o: Required<CameraOptions>) {
  if (!ax.moving && Math.abs(ideal - ax.x) > o.deadZone) ax.moving = true;
  if (!ax.moving) return;
  // Critically damped spring towards the subject: no overshoot, eases in and out.
  const w = 6 / o.settle;
  const a = w * w * (ideal - ax.x) - 2 * w * ax.v;
  ax.v = clamp(ax.v + a * dt, -o.maxSpeed, o.maxSpeed);
  ax.x += ax.v * dt;
  if (Math.abs(ideal - ax.x) < 0.002 && Math.abs(ax.v) < 0.01) {
    ax.x = ideal;
    ax.v = 0;
    ax.moving = false;
  }
}

/** Simulates the operator through one shot, emitting keyframes only while the camera moves. */
function filmShot(shot: Shot, pans: Keyframe[], o: Required<CameraOptions>): Keyframe[] {
  const first = pans[0];
  const out: Keyframe[] = [{ t: shot.start, x: first.x, y: first.y }];
  const end = pans[pans.length - 1].t;
  if (end <= shot.start) return out;
  const X: Axis = { x: first.x, v: 0, moving: false };
  const Y: Axis = { x: first.y, v: 0, moving: false };
  const dt = 1 / o.fps;
  const steps = Math.ceil((end - shot.start) * o.fps);
  let wasMoving = false;
  let still: Keyframe = out[0];
  for (let k = 1; k <= steps; k++) {
    const tt = Math.min(shot.start + k * dt, end);
    const ideal = idealAt(pans, tt);
    stepAxis(X, ideal.x, dt, o);
    stepAxis(Y, ideal.y, dt, o);
    const moving = X.moving || Y.moving;
    // Keyframes only while moving, bracketed by the last still frame before the move and the
    // first at rest after it, so every hold is exactly flat and every move starts from a stop.
    if (moving && !wasMoving && still.t > out[out.length - 1].t) out.push(still);
    if (moving || wasMoving) out.push({ t: tt, x: X.x, y: Y.x });
    else still = { t: tt, x: X.x, y: Y.x };
    wasMoving = moving;
  }
  return out;
}

/** Pan keyframes (source time) for the subject path, moved like a camera operator would. */
export function cameraPath(samples: SubjectSample[], clip: Clip, frame: Frame, options: CameraOptions = {}): Keyframe[] {
  const o = { ...DEFAULTS, ...options };
  const out: Keyframe[] = [];
  for (const shot of splitShots(dropSpikes(samples, o.jump), o)) {
    const pans = subjectPathToPan(median3(shot.samples), clip, frame);
    const prev = out[out.length - 1];
    // Hold the previous shot's framing right up to the cut, then start the new shot framed.
    if (prev && prev.t < shot.start - 0.001) out.push({ t: shot.start - 0.001, x: prev.x, y: prev.y });
    out.push(...filmShot(shot, pans, o));
  }
  return out;
}
