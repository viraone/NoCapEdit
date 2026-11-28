import type { CaptionCue, TextOverlay, WordTiming } from "@/lib/models/project";
import { createTextOverlay } from "@/lib/models/project";
import { buildCues, CAPTION_RULES } from "@/lib/speech/captionBuilder";

/** Re-groups cues into one word per cue, in start order. Input is not mutated. */
export function oneWordCues(cues: CaptionCue[]): CaptionCue[] {
  if (!cues.length) return [];
  const words: WordTiming[] = [];
  for (const cue of cues) {
    if (cue.words?.length) {
      for (const w of cue.words) words.push({ text: w.text, start: w.start, end: w.end });
      continue;
    }
    const tokens = cue.text.split(/\s+/).filter(Boolean);
    const span = Math.max(0.01, cue.end - cue.start);
    const step = span / tokens.length;
    tokens.forEach((text, i) => {
      words.push({ text, start: cue.start + i * step, end: cue.start + (i + 1) * step });
    });
  }
  return buildCues(words, { ...CAPTION_RULES, maxWords: 1 });
}

export interface TrailerPiece {
  start: number;
  end: number;
  name: string;
}

/** Name tags (neighbouring same-name pieces joined) plus an optional closing line. */
export function trailerOverlays(pieces: TrailerPiece[], closing: string): TextOverlay[] {
  const overlays: TextOverlay[] = [];
  let spanStart = 0;
  let spanEnd = 0;
  let spanName = "";
  let hasSpan = false;

  const flush = (): void => {
    if (hasSpan && spanName.trim()) {
      overlays.push({
        ...createTextOverlay("title", spanStart, spanEnd),
        text: spanName,
        color: "#000000",
        background: "#ffffff",
        x: 0.5,
        y: 0.62,
        fontSize: 0.026,
        maxWidth: 0.8,
        bold: true,
      });
    }
    hasSpan = false;
  };

  for (const piece of pieces) {
    const name = piece.name.trim();
    if (hasSpan && name === spanName) {
      spanEnd = piece.end;
      continue;
    }
    flush();
    spanStart = piece.start;
    spanEnd = piece.end;
    spanName = name;
    hasSpan = true;
  }
  flush();

  const last = pieces[pieces.length - 1];
  const text = closing.trim();
  if (text && last) {
    overlays.push({
      ...createTextOverlay("title", last.start, last.end),
      text,
      color: "#ffffff",
      background: null,
      x: 0.5,
      y: 0.52,
      fontSize: 0.026,
      maxWidth: 0.8,
      bold: true,
    });
  }

  return overlays;
}
