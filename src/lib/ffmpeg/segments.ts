/**
 * Splits the project timeline into render segments so long or high-resolution
 * exports are encoded in bounded chunks (each chunk streams to disk as soon as
 * it is done). Cuts are only placed where no transition is in progress, so
 * every segment can be rendered independently with the normal filter graph.
 */
import type { Clip } from "@/lib/models/project";
import { layoutClips, toSourceTime, type ClipLayout } from "@/lib/models/timeline";

export interface RenderSegment {
  index: number;
  /** Project-time range covered by this segment. */
  start: number;
  end: number;
  /** Trimmed clip copies whose own layout starts at 0 (== `start`). */
  clips: Clip[];
}

/** Margin kept around transitions so xfade always has frames to work with. */
const MARGIN = 0.3;
const MIN_SEGMENT = 1;

export interface SegmentPlanOptions {
  /**
   * Period (seconds) that every cut is moved onto, so each segment holds a
   * whole number of video frames and of AAC frames. Without it a segment's
   * AAC track is padded to the next frame and the following segment's audio
   * lands a few milliseconds late. 0 disables snapping.
   */
  grid?: number;
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/**
 * Smallest period that is a whole number of video frames and of AAC frames
 * (1024 samples): 0.5333 s at 30 and 60 fps, 2.6667 s at 24 fps, 0.32 s at 25 fps.
 * Falls back to one video frame when the frame rate does not divide the
 * sample rate (29.97 and friends).
 */
export function segmentGrid(fps: number, sampleRate = 48000, aacFrame = 1024): number {
  if (!(fps > 0)) return 0;
  const samplesPerFrame = sampleRate / fps;
  if (!Number.isInteger(samplesPerFrame)) return 1 / fps;
  return ((samplesPerFrame * aacFrame) / gcd(samplesPerFrame, aacFrame)) / sampleRate;
}

interface FreeRegion {
  from: number;
  to: number;
}

const EPS = 1e-6;

/** Moves `t` onto the grid, staying inside [from, to] and after notBefore; null when no grid point fits. */
function snapInto(t: number, grid: number, from: number, to: number, notBefore: number): number | null {
  if (grid <= 0) return t;
  const fits = (x: number) => x >= from - EPS && x <= to + EPS && x > notBefore + EPS;
  const down = Math.floor(t / grid + EPS) * grid;
  if (fits(down)) return down;
  const up = Math.ceil(t / grid - EPS) * grid;
  if (fits(up)) return up;
  return null;
}

/** Time ranges where a cut is allowed for a given layout. */
function freeRegion(l: ClipLayout): FreeRegion {
  const from = l.start + (l.transitionIn > 0 ? l.transitionIn + MARGIN : 0);
  const to = l.end - (l.transitionOut > 0 ? l.transitionOut + MARGIN : 0);
  return { from, to };
}

/** Finds the best cut at or before `desired` (on the grid), never earlier than `notBefore`. */
function findCut(regions: FreeRegion[], desired: number, notBefore: number, grid: number): number | null {
  let best: number | null = null;
  for (const r of regions) {
    if (r.from > r.to) continue;
    const candidate = snapInto(Math.min(desired, r.to), grid, r.from, r.to, notBefore);
    if (candidate !== null && candidate <= desired + EPS && (best === null || candidate > best)) best = candidate;
  }
  if (best !== null) return best;
  // Nothing before `desired`: take the first allowed point after it.
  let next: number | null = null;
  for (const r of regions) {
    if (r.from > r.to) continue;
    const candidate = snapInto(Math.max(r.from, desired), grid, r.from, r.to, notBefore);
    if (candidate !== null && candidate > desired && (next === null || candidate < next)) next = candidate;
  }
  return next;
}

function sliceClips(layouts: ClipLayout[], a: number, b: number): Clip[] {
  const out: Clip[] = [];
  for (const l of layouts) {
    if (l.end <= a + 1e-6 || l.start >= b - 1e-6) continue;
    const clip: Clip = structuredClone(l.clip);
    if (l.start < a - 1e-6) clip.inPoint = toSourceTime(l, a);
    if (l.end > b + 1e-6) {
      clip.outPoint = toSourceTime(l, b);
      clip.transition = { type: "none", duration: clip.transition.duration };
    }
    out.push(clip);
  }
  return out;
}

export function planSegments(clips: Clip[], targetSeconds: number, opts: SegmentPlanOptions = {}): RenderSegment[] {
  const grid = opts.grid ?? 0;
  const layouts = layoutClips(clips);
  if (!layouts.length) return [];
  const total = layouts[layouts.length - 1].end;
  if (targetSeconds <= 0 || total <= targetSeconds * 1.5) {
    return [{ index: 0, start: 0, end: total, clips: clips.map((c) => structuredClone(c)) }];
  }
  const regions = layouts.map(freeRegion);
  const cuts: number[] = [];
  let cursor = 0;
  while (total - cursor > targetSeconds * 1.5) {
    const cut = findCut(regions, cursor + targetSeconds, cursor + MIN_SEGMENT, grid);
    if (cut === null || cut >= total - MIN_SEGMENT) break;
    cuts.push(cut);
    cursor = cut;
  }
  const bounds = [0, ...cuts, total];
  const segments: RenderSegment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    segments.push({ index: i, start, end, clips: sliceClips(layouts, start, end) });
  }
  return segments;
}
