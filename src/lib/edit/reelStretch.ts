/**
 * Stretching a reel. A reel's media is cut from the source with slack on each
 * side (REEL_HANDLE in reelMaker), so on the timeline its clip's edges can be
 * dragged past what the reel shows. Past the slack, the wider range is cut
 * from the source video again; captions, text, stickers and voice-overs shift
 * to keep their place in the picture, and the source's captions fill the part
 * that is new.
 *
 * Ranges here are seconds on the source project's timeline, like ReelInfo.
 * The reel's media plays one second per source second (reels come from
 * clips at normal speed).
 */
import type { CaptionCue, Clip, VideoProject } from "@/lib/models/project";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";
import { getAsset } from "@/lib/storage/db";
import { importVideo } from "@/lib/media/import";
import { clamp } from "@/lib/utils/math";
import { cuesForRange, mediaWindow, trimMedia } from "./reelMaker";

export interface Range {
  start: number;
  end: number;
}

/** Seconds beyond the media on each side: available (reelSlack) or in use by a drag (stretchOf). */
export interface Slack {
  before: number;
  after: number;
}

/** Shortest range a stretch may leave, seconds. */
const MIN_RANGE = 0.5;

/** Source-timeline range the reel's media file covers; reels cut before slack existed hold exactly what they show. */
export function reelMedia(p: Pick<VideoProject, "reel">): Range | null {
  const r = p.reel;
  if (!r) return null;
  return r.media ?? { start: r.start, end: r.end };
}

/** Span, on the source timeline, of the source clip the reel was cut from (a reel comes from one clip). Null when the reel's start no longer falls inside the source. */
export function reelSourceRange(source: Pick<VideoProject, "clips">, reel: Pick<VideoProject, "reel">): Range | null {
  if (!reel.reel || !source.clips.length) return null;
  const at = reel.reel.start + 0.01;
  const loc = locateFrame(layoutClips(source.clips), at);
  if (!loc || at > loc.primary.end) return null;
  return { start: loc.primary.start, end: loc.primary.end };
}

/**
 * Seconds of the source video outside the reel's media on each side, or null
 * when the project can't be stretched: not a reel, the source is missing or
 * not this reel's, or the reel no longer has exactly one clip.
 */
export function reelSlack(reel: VideoProject, source: VideoProject | null): Slack | null {
  const media = reelMedia(reel);
  if (!media || !source || reel.sourceProjectId !== source.id || reel.clips.length !== 1) return null;
  const range = reelSourceRange(source, reel);
  if (!range) return null;
  return { before: Math.max(0, media.start - range.start), after: Math.max(0, range.end - media.end) };
}

/** How far a clip's in and out points sit outside its media; both zero except mid-drag on a reel. */
export function stretchOf(clip: Pick<Clip, "inPoint" | "outPoint" | "duration">): Slack {
  return { before: Math.max(0, -clip.inPoint), after: Math.max(0, clip.outPoint - clip.duration) };
}

/**
 * Adds the source's captions for the parts of `range` outside `shown` to the
 * reel's cues, which must already sit at their new project times. A source
 * caption that runs across an old edge was carried into the reel cut short
 * (same text, clipped at the edge); it is grown back instead of added twice.
 * Returns the cues sorted and how many were added.
 */
export function mergeStretchedCues(existing: CaptionCue[], sourceCues: CaptionCue[], range: Range, shown: Range): { cues: CaptionCue[]; added: number } {
  const cues = [...existing];
  const front = shown.start - range.start;
  const tailAt = shown.end - range.start;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.05;
  const wordsWithin = (c: CaptionCue, from: number, to: number) =>
    c.words?.map((w) => ({ ...w, start: clamp(w.start - range.start, from, to), end: clamp(w.end - range.start, from, to) })).filter((w) => w.end > w.start);
  let added = 0;
  if (front > 1e-6) {
    for (const c of sourceCues) {
      if (c.end <= range.start || c.start >= shown.start) continue;
      const carried = c.end > shown.start ? cues.find((e) => near(e.start, front) && e.text === c.text) : undefined;
      if (carried) {
        carried.start = Math.max(0, c.start - range.start);
        carried.words = wordsWithin(c, carried.start, carried.end);
      } else {
        cues.push(...cuesForRange([c], range.start, shown.start));
        added++;
      }
    }
  }
  if (range.end > shown.end + 1e-6) {
    for (const c of sourceCues) {
      if (c.start >= range.end || c.end <= shown.end) continue;
      const carried = c.start < shown.end ? cues.find((e) => near(e.end, tailAt) && e.text === c.text) : undefined;
      if (carried) {
        carried.end = Math.min(range.end, c.end) - range.start;
        carried.words = wordsWithin(c, carried.start, carried.end);
      } else {
        for (const f of cuesForRange([c], shown.end, range.end)) {
          f.start += tailAt;
          f.end += tailAt;
          f.words = f.words?.map((w) => ({ ...w, start: w.start + tailAt, end: w.end + tailAt }));
          cues.push(f);
          added++;
        }
      }
    }
  }
  cues.sort((a, b) => a.start - b.start);
  return { cues, added };
}

/** Moves everything timed to the project timeline by `by` seconds (negative = earlier). */
function shiftTimeline(p: VideoProject, by: number) {
  if (Math.abs(by) < 1e-9) return;
  for (const c of p.cues) {
    c.start += by;
    c.end += by;
    if (c.words) c.words = c.words.map((w) => ({ ...w, start: w.start + by, end: w.end + by }));
  }
  for (const o of p.overlays) {
    o.start = Math.max(0, o.start + by);
    o.end = Math.max(o.start, o.end + by);
    if (o.track) o.track = { ...o.track, keyframes: o.track.keyframes.map((k) => ({ ...k, t: k.t + by })) };
  }
  for (const v of p.voiceovers) v.start = Math.max(0, v.start + by);
}

export interface StretchApply {
  /** Clip made by importVideo for the new media file. */
  fresh: Clip;
  /** Source-timeline range the new media covers. */
  media: Range;
  /** Source-timeline range the reel shows after the stretch. */
  range: Range;
  /** The source project's captions, for the parts that are new. */
  sourceCues: CaptionCue[];
}

export interface StretchStats {
  /** Seconds brought back before and after what the reel showed. */
  before: number;
  after: number;
  addedCues: number;
  /** A cleaned-audio track was dropped: it was made for the old media. */
  droppedCleanAudio: boolean;
}

export interface RevealApply {
  /** Source-timeline range the reel showed before the trim. */
  shown: Range;
  /** Source-timeline range it shows now (the clip's in/out points are already there). */
  range: Range;
  /** The source project's captions, for the parts that are new. */
  sourceCues: CaptionCue[];
}

export interface RevealStats {
  /** Seconds brought back before and after what the reel showed. */
  before: number;
  after: number;
  addedCues: number;
}

/**
 * After a one-clip reel's shown range changed from `shown` to `range` (a trim
 * on the timeline, inside the media or after a stretch), with the reel's
 * captions, text, stickers and voice-overs already moved to their new times
 * (the timeline ripple does that for a drag, applyReelStretch for a re-cut):
 * brings in the source's captions for the parts that are new, drops what
 * fell off the ends, and records the range on the reel. Operates on a draft
 * project.
 */
export function applyReelReveal(p: VideoProject, o: RevealApply): RevealStats | null {
  const clip = p.clips[0];
  if (!p.reel || p.clips.length !== 1) return null;
  const front = o.shown.start - o.range.start;
  const length = (clip.outPoint - clip.inPoint) / clip.speed;
  p.cues = p.cues
    .map((c) => ({ ...c, start: clamp(c.start, 0, length), end: clamp(c.end, 0, length), words: c.words?.map((w) => ({ ...w, start: clamp(w.start, 0, length), end: clamp(w.end, 0, length) })).filter((w) => w.end > w.start) }))
    .filter((c) => c.end - c.start >= 0.15);
  const merged = mergeStretchedCues(p.cues, o.sourceCues, o.range, o.shown);
  p.cues = merged.cues;
  p.reel = { ...p.reel, start: o.range.start, end: o.range.end };
  return { before: Math.max(0, front), after: Math.max(0, o.range.end - o.shown.end), addedCues: merged.added };
}

/**
 * Swaps the reel's clip onto the new media and moves everything with it
 * (operates on a draft project). Null when the project isn't a one-clip reel.
 */
export function applyReelStretch(p: VideoProject, o: StretchApply): StretchStats | null {
  const oldMedia = reelMedia(p);
  const old = p.clips[0];
  if (!oldMedia || !p.reel || p.clips.length !== 1) return null;
  const shown = { start: oldMedia.start + old.inPoint, end: oldMedia.start + old.outPoint };
  // Media-time shift for keyframes and masks made against the old file.
  const delta = oldMedia.start - o.media.start;
  const inPoint = clamp(o.range.start - o.media.start, 0, Math.max(0, o.fresh.duration - 0.1));
  const outPoint = clamp(o.range.end - o.media.start, inPoint + 0.1, o.fresh.duration);
  p.clips[0] = {
    ...old,
    assetId: o.fresh.assetId,
    duration: o.fresh.duration,
    width: o.fresh.width,
    height: o.fresh.height,
    hasAudio: o.fresh.hasAudio,
    inPoint,
    outPoint,
    audioAssetId: null,
    audioLabel: null,
    reframe: old.reframe ? { ...old.reframe, keyframes: old.reframe.keyframes.map((k) => ({ ...k, t: k.t + delta })) } : old.reframe,
    matte: old.matte ? { ...old.matte, inPoint: old.matte.inPoint + delta, outPoint: old.matte.outPoint + delta } : old.matte,
  };
  // Project-time shift: positive when video came back before the old start.
  shiftTimeline(p, shown.start - o.range.start);
  const revealed = applyReelReveal(p, { shown, range: o.range, sourceCues: o.sourceCues })!;
  p.reel = { ...p.reel, media: o.media };
  return { ...revealed, droppedCleanAudio: !!old.audioAssetId };
}

export interface StretchOptions {
  source: VideoProject;
  reel: VideoProject;
  /** Source-timeline range the reel should show; clamped to the source clip it came from. */
  range: Range;
  /** Pre-allocated asset id, so the caller can protect it from cleanup while the cut runs. */
  assetId?: string;
  onProgress?: (message: string, progress: number | null) => void;
  signal?: AbortSignal;
}

export interface StretchCut {
  clip: Clip;
  blob: Blob;
  media: Range;
  range: Range;
}

const abortError = () => new DOMException("Cancelled", "AbortError");

/**
 * Cuts the reel's media again from the source around `range` (with fresh
 * slack) and stores it under the reel; the project itself is untouched, the
 * caller applies the result with applyReelStretch.
 */
export async function stretchReel(o: StretchOptions): Promise<StretchCut> {
  if (!o.reel.reel || o.reel.sourceProjectId !== o.source.id) throw new Error("This project isn't a reel of that video.");
  const bounds = reelSourceRange(o.source, o.reel);
  if (!bounds) throw new Error("The source video no longer has this part.");
  const layout = locateFrame(layoutClips(o.source.clips), o.reel.reel.start + 0.01)!.primary;
  const range = {
    start: clamp(o.range.start, bounds.start, bounds.end - MIN_RANGE),
    end: clamp(o.range.end, bounds.start + MIN_RANGE, bounds.end),
  };
  if (range.end - range.start < MIN_RANGE) throw new Error("The range is too short.");
  const media = mediaWindow(range, bounds);
  const sourceStart = toSourceTime(layout, media.start);
  const seconds = Math.max(1, toSourceTime(layout, media.end) - sourceStart);
  const asset = await getAsset(layout.clip.assetId);
  if (!asset) throw new Error("The source video is missing from local storage.");

  const label = `Cutting ${Math.round(range.end - range.start)} s from the source video`;
  o.onProgress?.(label, null);
  const blob = await trimMedia(asset.blob, sourceStart, seconds, { signal: o.signal, onProgress: (f) => o.onProgress?.(label, f) });
  if (o.signal?.aborted) throw abortError();
  const file = new File([blob], `${o.reel.name.replace(/[\\/:*?"<>|]+/g, " ")}.mp4`, { type: "video/mp4" });
  const { clip } = await importVideo(file, o.reel.id, (m) => o.onProgress?.(m, null), o.assetId);
  if (o.signal?.aborted) throw abortError();
  return { clip, blob, media, range };
}
