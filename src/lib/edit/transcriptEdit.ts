/**
 * Text-based editing: the captions' words as one flat, ordered transcript, and
 * the conversion of a selected run of words into the time range to cut. The
 * cut itself is `applyRemovals` (the same ripple Magic Cut uses).
 */
import type { CaptionCue } from "@/lib/models/project";
import type { TimeRange } from "@/lib/edit/magicCut";

export interface TranscriptWord {
  text: string;
  start: number;
  end: number;
  cueId: string;
  speaker?: number;
}

export interface Paragraph {
  /** Index of the paragraph's first word in the flat list. */
  from: number;
  /** One past its last word. */
  to: number;
  start: number;
  speaker?: number;
}

/** A pause between two cues longer than this starts a new paragraph. */
export const PARAGRAPH_GAP = 1.2;
/** Most the cut reaches beyond a word into the pause around it, so breath and clipped consonants go with it. */
const MAX_PAD = 0.04;

/** Every word of every cue in timeline order. A cue without word timings (an imported SRT) is one "word". */
export function flattenTranscript(cues: CaptionCue[]): TranscriptWord[] {
  const out: TranscriptWord[] = [];
  for (const cue of [...cues].sort((a, b) => a.start - b.start)) {
    if (cue.words?.length) {
      for (const w of cue.words) if (w.text.trim()) out.push({ text: w.text.trim(), start: w.start, end: w.end, cueId: cue.id, speaker: cue.speaker });
    } else if (cue.text.trim()) {
      out.push({ text: cue.text.trim(), start: cue.start, end: cue.end, cueId: cue.id, speaker: cue.speaker });
    }
  }
  return out;
}

/** Paragraphs break when the speaker changes or after a long pause. */
export function groupParagraphs(words: TranscriptWord[]): Paragraph[] {
  const out: Paragraph[] = [];
  words.forEach((w, i) => {
    const prev = words[i - 1];
    if (!prev || prev.speaker !== w.speaker || w.start - prev.end > PARAGRAPH_GAP) {
      if (out.length) out[out.length - 1].to = i;
      out.push({ from: i, to: words.length, start: w.start, speaker: w.speaker });
    }
  });
  return out;
}

/** Index of the word being spoken at `t`, or the last one before it; -1 before the first word. */
export function activeWordIndex(words: TranscriptWord[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** Time to cut for words `a..b` (either order, inclusive), reaching half-way into the neighbouring pauses up to MAX_PAD. */
export function rangeForWords(words: TranscriptWord[], a: number, b: number): TimeRange | null {
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(words.length - 1, Math.max(a, b));
  if (lo > hi || !words[lo] || !words[hi]) return null;
  const first = words[lo];
  const last = words[hi];
  const before = words[lo - 1];
  const after = words[hi + 1];
  const padBefore = before ? Math.min(MAX_PAD, Math.max(0, (first.start - before.end) / 2)) : MAX_PAD;
  const padAfter = after ? Math.min(MAX_PAD, Math.max(0, (after.start - last.end) / 2)) : MAX_PAD;
  const start = Math.max(0, first.start - padBefore);
  const end = last.end + padAfter;
  if (end <= start) return null;
  const label = words.slice(lo, hi + 1).map((w) => w.text).join(" ");
  return { start, end, kind: "custom", label };
}
