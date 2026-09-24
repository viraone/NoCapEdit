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

interface FreeRegion {
  from: number;
  to: number;
}

/** Time ranges where a cut is allowed for a given layout. */
function freeRegion(l: ClipLayout): FreeRegion {
  const from = l.start + (l.transitionIn > 0 ? l.transitionIn + MARGIN : 0);
  const to = l.end - (l.transitionOut > 0 ? l.transitionOut + MARGIN : 0);
  return { from, to };
}

/** Finds the best cut at or before `desired`, never earlier than `notBefore`. */
function findCut(regions: FreeRegion[], desired: number, notBefore: number): number | null {
  let best: number | null = null;
  for (const r of regions) {
    if (r.from > r.to) continue;
    const candidate = Math.min(desired, r.to);
    if (candidate >= r.from && candidate > notBefore && (best === null || candidate > best)) best = candidate;
  }
  if (best !== null) return best;
  // Nothing before `desired`: take the first allowed point after it.
  let next: number | null = null;
  for (const r of regions) {
    if (r.from > r.to) continue;
    if (r.from > desired && r.from > notBefore && (next === null || r.from < next)) next = r.from;
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

export function planSegments(clips: Clip[], targetSeconds: number): RenderSegment[] {
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
    const cut = findCut(regions, cursor + targetSeconds, cursor + MIN_SEGMENT);
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
