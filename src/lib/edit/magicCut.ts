/**
 * "Magic Cut": finds filler words (from Whisper word timings) and dead air
 * (from waveform peaks) and removes those ranges from the timeline, keeping
 * captions, overlays and voice-overs in sync.
 */
import type { CaptionCue, Clip, VideoProject } from "@/lib/models/project";
import { layoutClips, toProjectTime, toSourceTime, type ClipLayout } from "@/lib/models/timeline";
import { uid } from "@/lib/utils/id";

export interface TimeRange {
  start: number;
  end: number;
  kind: "filler" | "silence" | "custom";
  label?: string;
}

export const DEFAULT_FILLERS = ["um", "umm", "uh", "uhh", "uhm", "er", "erm", "ah", "ahh", "hmm", "mm", "mhm", "huh"];
export const OPTIONAL_FILLERS = ["like", "basically", "actually", "literally", "right", "okay", "so"];

const normalize = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");

/** Filler words as project-time ranges (needs cues with word timings). */
export function findFillerWords(cues: CaptionCue[], fillers: string[] = DEFAULT_FILLERS, pad = 0.03): TimeRange[] {
  // Single words go through normalize(); phrases ("you know") are matched word by word.
  const phrases = new Set(fillers.filter((f) => /\s/.test(f.trim())).map((f) => f.trim().split(/\s+/).map(normalize).join(" ")));
  const set = new Set(fillers.filter((f) => !/\s/.test(f.trim())).map(normalize));
  const out: TimeRange[] = [];
  for (const cue of cues) {
    const words = cue.words;
    if (!words?.length) continue;
    for (let i = 0; i < words.length; i++) {
      const w = normalize(words[i].text);
      const next = words[i + 1] ? normalize(words[i + 1].text) : "";
      if (next && phrases.has(`${w} ${next}`)) {
        out.push({ start: Math.max(cue.start, words[i].start - pad), end: Math.min(cue.end, words[i + 1].end + pad), kind: "filler", label: `${words[i].text} ${words[i + 1].text}` });
        i++;
        continue;
      }
      if (set.has(w)) out.push({ start: Math.max(cue.start, words[i].start - pad), end: Math.min(cue.end, words[i].end + pad), kind: "filler", label: words[i].text });
    }
  }
  return out.filter((r) => r.end > r.start);
}

export interface SilenceOptions {
  /** Peak level (0..1) under which audio counts as silent. */
  threshold: number;
  /** Minimum silent stretch (seconds) worth removing. */
  minGap: number;
  /** Seconds kept on both sides of a gap so speech is not clipped. */
  margin: number;
}

export const DEFAULT_SILENCE: SilenceOptions = { threshold: 0.08, minGap: 0.7, margin: 0.15 };

/** Dead air inside one clip, as project-time ranges. */
export function findSilences(peaks: { peaks: Uint8Array; perSecond: number }, layout: ClipLayout, opts: SilenceOptions = DEFAULT_SILENCE): TimeRange[] {
  const { clip } = layout;
  const out: TimeRange[] = [];
  const level = opts.threshold * 255;
  const from = Math.max(0, Math.floor(clip.inPoint * peaks.perSecond));
  const to = Math.min(peaks.peaks.length, Math.ceil(clip.outPoint * peaks.perSecond));
  let runStart = -1;
  const flush = (endIdx: number) => {
    if (runStart < 0) return;
    const s = runStart / peaks.perSecond + opts.margin;
    const e = endIdx / peaks.perSecond - opts.margin;
    if (e - s >= Math.max(0.1, opts.minGap - opts.margin * 2)) {
      out.push({ start: toProjectTime(layout, Math.max(clip.inPoint, s)), end: toProjectTime(layout, Math.min(clip.outPoint, e)), kind: "silence" });
    }
    runStart = -1;
  };
  for (let i = from; i < to; i++) {
    if (peaks.peaks[i] < level) {
      if (runStart < 0) runStart = i;
    } else flush(i);
  }
  flush(to);
  return out.filter((r) => r.end - r.start >= 0.1);
}

export function mergeRanges(ranges: TimeRange[], gap = 0.02): TimeRange[] {
  const sorted = [...ranges].filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const out: TimeRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + gap) {
      last.end = Math.max(last.end, r.end);
      if (last.kind !== r.kind) last.kind = "custom";
    } else out.push({ ...r });
  }
  return out;
}

export function totalDuration(ranges: TimeRange[]): number {
  return mergeRanges(ranges).reduce((s, r) => s + (r.end - r.start), 0);
}

/** Intervals of [a, b] that are not covered by `removed` (sorted, merged). */
export function subtractRanges(a: number, b: number, removed: TimeRange[]): [number, number][] {
  const kept: [number, number][] = [];
  let cursor = a;
  for (const r of removed) {
    if (r.end <= cursor) continue;
    if (r.start >= b) break;
    if (r.start > cursor) kept.push([cursor, Math.min(r.start, b)]);
    cursor = Math.max(cursor, r.end);
    if (cursor >= b) break;
  }
  if (cursor < b) kept.push([cursor, b]);
  return kept;
}

/** Monotone map from old project time to new project time after removals. */
export function makeTimeMap(removed: TimeRange[]): (t: number) => number {
  return (t: number) => {
    let cut = 0;
    for (const r of removed) {
      if (t <= r.start) break;
      cut += Math.min(t, r.end) - r.start;
    }
    return t - cut;
  };
}

export interface RemovalStats {
  removedSeconds: number;
  clipsBefore: number;
  clipsAfter: number;
  cuesDropped: number;
}

/** Removes the ranges from the project in place and re-times everything else. */
export function applyRemovals(project: VideoProject, ranges: TimeRange[]): RemovalStats {
  const layouts = layoutClips(project.clips);
  const duration = layouts.length ? layouts[layouts.length - 1].end : 0;
  const removed = mergeRanges(ranges).map((r) => ({ ...r, start: Math.max(0, r.start), end: Math.min(duration, r.end) })).filter((r) => r.end > r.start);
  if (!removed.length) return { removedSeconds: 0, clipsBefore: project.clips.length, clipsAfter: project.clips.length, cuesDropped: 0 };
  const map = makeTimeMap(removed);

  const clips: Clip[] = [];
  for (const layout of layouts) {
    const kept = subtractRanges(layout.start, layout.end, removed).filter(([a, b]) => b - a >= 0.08);
    kept.forEach(([a, b], i) => {
      const piece: Clip = { ...structuredClone(layout.clip), id: i === 0 ? layout.clip.id : uid("clip"), inPoint: toSourceTime(layout, a), outPoint: toSourceTime(layout, b) };
      if (i < kept.length - 1) piece.transition = { type: "none", duration: piece.transition.duration };
      clips.push(piece);
    });
  }
  const clipsBefore = project.clips.length;
  project.clips = clips;

  const inRemoved = (t: number) => removed.some((r) => t >= r.start && t < r.end);
  let cuesDropped = 0;
  const cues: CaptionCue[] = [];
  for (const cue of project.cues) {
    if (cue.words?.length) {
      const kept = cue.words.filter((w) => !inRemoved((w.start + w.end) / 2));
      if (!kept.length) {
        cuesDropped++;
        continue;
      }
      const words = kept.map((w) => ({ ...w, start: map(w.start), end: map(w.end) }));
      const start = map(inRemoved(cue.start) ? kept[0].start : cue.start);
      const end = Math.max(start + 0.15, map(cue.end));
      cues.push({ ...cue, start, end, words, text: kept.length === cue.words.length ? cue.text : kept.map((w) => w.text).join(" "), translatedText: kept.length === cue.words.length ? cue.translatedText : undefined });
    } else {
      const keptParts = subtractRanges(cue.start, cue.end, removed);
      if (!keptParts.length) {
        cuesDropped++;
        continue;
      }
      const start = map(keptParts[0][0]);
      const end = Math.max(start + 0.15, map(keptParts[keptParts.length - 1][1]));
      cues.push({ ...cue, start, end });
    }
  }
  project.cues = cues;

  project.overlays = project.overlays
    .map((o) => ({ ...o, start: map(o.start), end: map(o.end) }))
    .filter((o) => o.end - o.start >= 0.05);
  project.voiceovers = project.voiceovers.filter((v) => !inRemoved(v.start)).map((v) => ({ ...v, start: map(v.start) }));

  return { removedSeconds: removed.reduce((s, r) => s + (r.end - r.start), 0), clipsBefore, clipsAfter: clips.length, cuesDropped };
}

/** Keeps only [start, end] of the timeline (used by the highlight finder). */
export function keepOnly(project: VideoProject, start: number, end: number): RemovalStats {
  const layouts = layoutClips(project.clips);
  const duration = layouts.length ? layouts[layouts.length - 1].end : 0;
  const ranges: TimeRange[] = [];
  if (start > 0) ranges.push({ start: 0, end: start, kind: "custom" });
  if (end < duration) ranges.push({ start: end, end: duration, kind: "custom" });
  return applyRemovals(project, ranges);
}
