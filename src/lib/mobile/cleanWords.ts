import type { WordTiming } from "@/lib/models/project";

/**
 * Whisper hallucination guard. On noisy audio (a comedy club: laughter,
 * applause, a room mic) the small models can fall into a loop — "yeah,
 * yeah, yeah, …" for a whole chunk — with every word stamped at the same
 * instant near the 30-second chunk boundary. Two symptoms, two filters:
 *
 *  1. A burst of many words sharing one timestamp is not speech; drop it.
 *  2. The same word or short phrase repeated over and over is capped.
 */

const BURST_MIN_WORDS = 8;
const BURST_WINDOW_S = 0.15;
/** How many consecutive repeats of a word/phrase to keep. */
const MAX_REPEATS = 3;

function norm(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, "");
}

/** Removes runs of ≥ BURST_MIN_WORDS words whose start times all fall inside a tiny window. */
export function dropTimestampBursts(words: WordTiming[]): WordTiming[] {
  const out: WordTiming[] = [];
  let i = 0;
  while (i < words.length) {
    let j = i + 1;
    while (j < words.length && Math.abs(words[j].start - words[i].start) <= BURST_WINDOW_S) j += 1;
    if (j - i >= BURST_MIN_WORDS) {
      i = j; // hallucinated burst: skip it entirely
      continue;
    }
    out.push(words[i]);
    i += 1;
  }
  return out;
}

const MAX_PHRASE_WORDS = 8;

/** One pass: caps back-to-back repeats of every n-word phrase at MAX_REPEATS. */
function capPhraseRepeats(words: WordTiming[], n: number): WordTiming[] {
  const keys = words.map((w) => norm(w.text));
  const drop = new Array<boolean>(words.length).fill(false);
  let i = 0;
  while (i + n <= words.length) {
    let repeats = 1;
    while (i + (repeats + 1) * n <= words.length) {
      let same = true;
      for (let k = 0; k < n; k++) {
        if (keys[i + k] === "" || keys[i + k] !== keys[i + repeats * n + k]) {
          same = false;
          break;
        }
      }
      if (!same) break;
      repeats += 1;
    }
    if (repeats > MAX_REPEATS) {
      for (let r = MAX_REPEATS; r < repeats; r++) for (let k = 0; k < n; k++) drop[i + r * n + k] = true;
      i += repeats * n;
    } else {
      i += 1;
    }
  }
  return words.filter((_, idx) => !drop[idx]);
}

/** Caps consecutive repeats of any phrase up to MAX_PHRASE_WORDS long. Each
 * pass works on the already-filtered list so a capped word can't mask a
 * longer repeated phrase. */
export function capRepeats(words: WordTiming[]): WordTiming[] {
  let out = words;
  for (let n = 1; n <= MAX_PHRASE_WORDS; n++) out = capPhraseRepeats(out, n);
  return out;
}

export function cleanWords(words: WordTiming[]): WordTiming[] {
  return capRepeats(dropTimestampBursts(words));
}
