import type { CaptionCue, WordTiming } from "@/lib/models/project";
import { uid } from "@/lib/utils/id";

/** Grouping rules for turning recognised words into subtitle cues. */
export interface CaptionRules {
  /** Maximum words per cue. */
  maxWords: number;
  /** Maximum cue length in seconds. */
  maxDuration: number;
  /** A pause longer than this (seconds) ends the current cue. */
  pauseThreshold: number;
  /** Seconds kept on screen after the final word. */
  tail: number;
  /** Minimum cue duration in seconds. */
  minDuration: number;
}

export const CAPTION_RULES: CaptionRules = { maxWords: 4, maxDuration: 2.4, pauseThreshold: 0.6, tail: 0.25, minDuration: 0.5 };

function cleanWords(words: WordTiming[]): WordTiming[] {
  return words
    .map((w) => ({ ...w, text: w.text.trim() }))
    .filter((w) => w.text.length > 0 && Number.isFinite(w.start) && Number.isFinite(w.end))
    .map((w) => ({ ...w, end: Math.max(w.end, w.start) }))
    .sort((a, b) => a.start - b.start);
}

/**
 * Groups word timings into cues:
 *  - at most `maxWords` words per cue
 *  - at most `maxDuration` seconds per cue
 *  - a pause longer than `pauseThreshold` ends the cue
 *  - `tail` seconds are added after the final word
 *  - every cue lasts at least `minDuration` seconds
 * Cues never overlap: a cue is clipped where the next one starts.
 */
export function buildCues(input: WordTiming[], rules: CaptionRules = CAPTION_RULES): CaptionCue[] {
  const words = cleanWords(input);
  const groups: WordTiming[][] = [];
  let group: WordTiming[] = [];

  for (const word of words) {
    if (group.length) {
      const first = group[0];
      const last = group[group.length - 1];
      const tooMany = group.length >= rules.maxWords;
      const tooLong = word.end - first.start > rules.maxDuration;
      const pause = word.start - last.end > rules.pauseThreshold;
      if (tooMany || tooLong || pause) {
        groups.push(group);
        group = [];
      }
    }
    group.push(word);
  }
  if (group.length) groups.push(group);

  const cues: CaptionCue[] = groups.map((g) => {
    const start = g[0].start;
    const rawEnd = g[g.length - 1].end + rules.tail;
    const end = Math.max(rawEnd, start + rules.minDuration);
    return {
      id: uid("cue"),
      start,
      end,
      text: g.map((w) => w.text).join(" "),
      words: g.map((w) => ({ text: w.text, start: w.start, end: w.end })),
      anchor: null,
    };
  });

  for (let i = 0; i < cues.length - 1; i++) {
    const next = cues[i + 1];
    if (cues[i].end > next.start) cues[i].end = Math.max(cues[i].start, next.start);
  }
  return cues;
}

/** Shifts every cue (and its words) by `offset` seconds. */
export function shiftCues(cues: CaptionCue[], offset: number): CaptionCue[] {
  return cues.map((c) => ({
    ...c,
    start: c.start + offset,
    end: c.end + offset,
    words: c.words?.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset })),
  }));
}

export function mergeCues(a: CaptionCue, b: CaptionCue): CaptionCue {
  const [first, second] = a.start <= b.start ? [a, b] : [b, a];
  return {
    id: first.id,
    start: first.start,
    end: Math.max(first.end, second.end),
    text: `${first.text} ${second.text}`.trim(),
    translatedText:
      first.translatedText || second.translatedText
        ? `${first.translatedText ?? ""} ${second.translatedText ?? ""}`.trim()
        : undefined,
    words: first.words && second.words ? [...first.words, ...second.words] : undefined,
    anchor: first.anchor ?? null,
  };
}

/** Splits a cue in two at a word index (the second cue starts at that word). */
export function splitCue(cue: CaptionCue, wordIndex: number): [CaptionCue, CaptionCue] | null {
  const tokens = cue.text.split(/\s+/).filter(Boolean);
  if (wordIndex <= 0 || wordIndex >= tokens.length) return null;
  const hasWords = cue.words && cue.words.length === tokens.length;
  const splitTime = hasWords
    ? cue.words![wordIndex].start
    : cue.start + ((cue.end - cue.start) * wordIndex) / tokens.length;
  const first: CaptionCue = {
    ...cue,
    end: splitTime,
    text: tokens.slice(0, wordIndex).join(" "),
    translatedText: undefined,
    words: hasWords ? cue.words!.slice(0, wordIndex) : undefined,
  };
  const second: CaptionCue = {
    ...cue,
    id: uid("cue"),
    start: splitTime,
    text: tokens.slice(wordIndex).join(" "),
    translatedText: undefined,
    words: hasWords ? cue.words!.slice(wordIndex) : undefined,
  };
  return [first, second];
}

export function sortCues(cues: CaptionCue[]): CaptionCue[] {
  return [...cues].sort((a, b) => a.start - b.start);
}
