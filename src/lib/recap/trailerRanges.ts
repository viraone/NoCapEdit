export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface Range {
  start: number;
  end: number;
}

export function pieceFor(laugh: Range, cues: Cue[], duration: number): Range {
  const end = Math.min(duration, Math.min(laugh.end, laugh.start + 2.5) + 0.4);
  const earliest = end - 7;
  const before = cues
    .slice()
    .sort((a, b) => a.start - b.start)
    .filter((c) => c.start < laugh.start);

  let start: number;
  if (before.length === 0 || laugh.start - before[before.length - 1].end > 7) {
    start = laugh.start - 4;
  } else {
    let i = before.length - 1;
    while (i > 0) {
      const sentenceEnded = /[.?!]$/.test(before[i - 1].text.trim());
      const paused = before[i].start - before[i - 1].end >= 0.7;
      if (sentenceEnded || paused || before[i - 1].start < earliest) break;
      i--;
    }
    start = before[i].start;
  }

  start = Math.max(start, earliest);
  start = Math.min(start, end - 3);
  start = Math.max(0, start);

  return { start, end: Math.min(duration, Math.max(end, start + 3)) };
}

export function trailerRanges(laughs: Range[], cues: Cue[], duration: number): Range[] {
  const pieces = laughs.map((l) => pieceFor(l, cues, duration));
  pieces.sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  for (const p of pieces) {
    if (merged.length === 0) {
      merged.push({ ...p });
    } else {
      const last = merged[merged.length - 1];
      if (p.start <= last.end) {
        last.end = Math.max(last.end, p.end);
      } else {
        merged.push({ ...p });
      }
    }
  }
  return merged;
}

export function totalLength(ranges: Range[]): number {
  return ranges.reduce((sum, r) => sum + (r.end - r.start), 0);
}
