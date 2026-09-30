/**
 * Keeps captions, text, stickers and voice-overs on the same picture when
 * the clip sequence changes. Everything on the timeline is stored in
 * project seconds, and an edit that trims, cuts, splits, speeds up, reorders
 * or removes clips moves the picture under those seconds. rippleTimeline
 * maps each timed thing from where it sat in `base` (the project before the
 * edit, or before the drag began) to where that moment of video now is in
 * `next`, going through the clip and source time it was on. Captions of
 * moments that were cut away go with them; text, stickers and voice-overs
 * slide to the nearest surviving moment instead of vanishing.
 */
import type { CaptionCue, Keyframe, Overlay, VideoProject, Voiceover, WordTiming } from "./project";
import { findLayout, layoutClips, locateFrame, toProjectTime, toSourceTime, type ClipLayout } from "./timeline";
import { clamp } from "@/lib/utils/math";

const EPS = 1e-6;
/** Shortest caption kept after a cut, seconds. */
export const MIN_CUE = 0.1;
const round = (t: number) => Math.round(t * 1e4) / 1e4;

export interface MappedTime {
  time: number;
  /** The clip that now shows the moment; its span bounds anything that lost its own moment. */
  layout: ClipLayout;
}

/**
 * Where project time `t` of the `from` layout sits in the `to` layout, or
 * null when the clip it was on is gone. A moment trimmed away lands on the
 * nearest edge of what its clip still shows. The end of a span is looked up
 * a hair earlier, so an end that sits exactly on a clip boundary belongs to
 * the clip before it.
 */
export function mapTime(from: ClipLayout[], to: ClipLayout[], t: number, side: "start" | "end" = "start"): MappedTime | null {
  if (!from.length || !to.length) return null;
  const oldEnd = from[from.length - 1].end;
  const newEnd = to[to.length - 1].end;
  // Past the end of the video: keep the same distance past the new end.
  if (t > oldEnd + EPS) return { time: round(t + (newEnd - oldEnd)), layout: to[to.length - 1] };
  const at = Math.max(0, side === "end" ? t - 1e-4 : t);
  const loc = locateFrame(from, at);
  if (!loc) return null;
  const src = loc.primary;
  const s = toSourceTime(src, Math.max(0, t));
  const holds = (l: ClipLayout) => l.clip.assetId === src.clip.assetId && s >= l.clip.inPoint - EPS && s <= l.clip.outPoint + EPS;
  const same = findLayout(to, src.clip.id);
  // The same clip while it still shows the moment, else any clip on the same file that does (the other half of a split).
  const dst = same && holds(same) ? same : (to.find(holds) ?? same);
  if (!dst) return null;
  return { time: round(toProjectTime(dst, clamp(s, dst.clip.inPoint, dst.clip.outPoint))), layout: dst };
}

/**
 * Where a span now sits, or null when both its ends were on clips that are
 * gone. A span that lost one end keeps to the clip of the other; one whose
 * ends no longer sit on neighbouring clips keeps to the clip it starts on.
 */
export function mapSpan(from: ClipLayout[], to: ClipLayout[], start: number, end: number): { start: number; end: number } | null {
  const a = mapTime(from, to, start, "start");
  const b = mapTime(from, to, end, "end");
  if (!a && !b) return null;
  let s = a ? a.time : b!.layout.start;
  let e = b ? b.time : a!.layout.end;
  if (a && b && b.layout.index !== a.layout.index && b.layout.index !== a.layout.index + 1) e = a.layout.end;
  s = round(s);
  e = round(e);
  return { start: s, end: e };
}

function rippleCue(from: ClipLayout[], to: ClipLayout[], c: CaptionCue): CaptionCue | null {
  const span = mapSpan(from, to, c.start, c.end);
  if (!span || span.end - span.start < MIN_CUE) return null;
  const next: CaptionCue = { ...c, start: span.start, end: span.end };
  if (c.words) {
    const kept = c.words
      .map((w) => {
        const ws = mapSpan(from, to, w.start, w.end);
        return ws ? { ...w, start: clamp(ws.start, span.start, span.end), end: clamp(ws.end, span.start, span.end) } : null;
      })
      .filter((w): w is WordTiming => !!w && w.end - w.start > EPS);
    next.words = kept;
    // Words that were cut away leave the caption's text too (as Magic Cut does); a translation no longer matches.
    if (kept.length < c.words.length && kept.length) {
      next.text = kept.map((w) => w.text).join(" ");
      delete next.translatedText;
    }
  }
  return next;
}

function rippleOverlay(from: ClipLayout[], to: ClipLayout[], o: Overlay): Overlay {
  const next = structuredClone(o);
  const span = mapSpan(from, to, o.start, o.end);
  if (span) {
    next.start = span.start;
    next.end = Math.max(span.start + MIN_CUE, span.end);
  }
  if (next.track) {
    const keyframes = next.track.keyframes
      .map((k) => {
        const m = mapTime(from, to, k.t, "start");
        return m ? { ...k, t: m.time } : null;
      })
      .filter((k): k is Keyframe => !!k)
      .sort((x, y) => x.t - y.t);
    next.track = keyframes.length ? { ...next.track, keyframes } : null;
  }
  return next;
}

function rippleVoiceover(from: ClipLayout[], to: ClipLayout[], v: Voiceover): Voiceover {
  const m = mapTime(from, to, v.start, "start");
  return m ? { ...v, start: m.time } : { ...v };
}

/** True when every clip shows the same source range at the same place, so nothing on the timeline has moved. */
export function sameSequence(from: ClipLayout[], to: ClipLayout[]): boolean {
  return (
    from.length === to.length &&
    from.every((l, i) => {
      const m = to[i];
      return (
        l.clip.id === m.clip.id &&
        l.clip.assetId === m.clip.assetId &&
        Math.abs(l.start - m.start) < EPS &&
        Math.abs(l.end - m.end) < EPS &&
        l.clip.inPoint === m.clip.inPoint &&
        l.clip.outPoint === m.clip.outPoint &&
        l.clip.speed === m.clip.speed
      );
    })
  );
}

/**
 * Replaces the captions, text, stickers and voice-overs of `next` with those
 * of `base`, moved onto the clips of `next`. When the clip sequence is the
 * same they are copied as they are (a drag that came back to where it
 * began gets its originals back). Returns whether anything moved. `base` is
 * never changed.
 */
export function rippleTimeline(base: VideoProject, next: VideoProject): boolean {
  const from = layoutClips(base.clips);
  const to = layoutClips(next.clips);
  if (!from.length) return false;
  if (sameSequence(from, to)) {
    next.cues = structuredClone(base.cues);
    next.overlays = structuredClone(base.overlays);
    next.voiceovers = structuredClone(base.voiceovers);
    return false;
  }
  next.cues = base.cues
    .flatMap((c) => {
      const r = rippleCue(from, to, c);
      return r ? [r] : [];
    })
    .sort((x, y) => x.start - y.start);
  next.overlays = base.overlays.map((o) => rippleOverlay(from, to, o));
  next.voiceovers = base.voiceovers.map((v) => rippleVoiceover(from, to, v));
  return true;
}
