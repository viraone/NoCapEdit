export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface PerformerSet {
  start: number;
  end: number;
  name: string;
}

export function captionLines(cues: Cue[]): Cue[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const lines: Cue[] = [];
  for (const cue of sorted) {
    const last = lines[lines.length - 1];
    if (
      last &&
      cue.start - last.end < 0.8 &&
      !/[.?!]$/.test(last.text)
    ) {
      last.text = last.text + " " + cue.text;
      last.end = Math.max(last.end, cue.end);
    } else {
      lines.push({ ...cue });
    }
  }
  return lines;
}

export function isHandover(text: string): boolean {
  const t = text.toLowerCase();
  const patterns = [
    /\b(keep (it|that) going|been going|give it up|even hope|make some noise|clap it up|one more time)\b[^.?!]*\bfor\b/,
    /\b(next|another) (comedian|comic|comment|performer)\b/,
    /\bready for (our|the|a) (next|headliner)\b/,
    /\b(welcome to (the )?stage|coming (up )?to the stage|coming up right now|we got one more comedian)\b/,
  ];
  return patterns.some((p) => p.test(t));
}

export function spokenName(text: string): string {
  const match = text.match(/\bfor\s+((?:[A-Z][A-Za-z'’-]+)(?:\s+[A-Z][A-Za-z'’-]+)?)/);
  if (!match) return "";
  const stopWords = new Set([
    "The", "Our", "Your", "Me", "Everybody", "Everyone",
    "This", "That", "Day", "Host", "Us", "My", "All", "Real", "You",
    "Tonight",
  ]);
  const words = match[1].split(/\s+/).filter((w) => !stopWords.has(w));
  return words.join(" ");
}

export function findSets(cues: Cue[], duration: number): PerformerSet[] {
  if (cues.length === 0) return [];
  const lines = captionLines(cues);
  const handoverLines = lines.filter((l) => isHandover(l.text));

  if (handoverLines.length === 0) {
    return [{ start: 0, end: duration, name: "" }];
  }

  interface Handover {
    start: number;
    end: number;
    lines: Cue[];
  }

  const handovers: Handover[] = [];
  for (const line of handoverLines) {
    const last = handovers[handovers.length - 1];
    if (last && line.start - last.end <= 90) {
      last.end = line.end;
      last.lines.push(line);
    } else {
      handovers.push({ start: line.start, end: line.end, lines: [line] });
    }
  }

  const sets: PerformerSet[] = [];
  let currentStart = 0;

  for (let i = 0; i < handovers.length; i++) {
    const h = handovers[i];
    const stretchEnd = h.start;
    if (stretchEnd - currentStart >= 120) {
      let name = "";
      for (const line of h.lines) {
        const n = spokenName(line.text);
        if (n) {
          name = n;
          break;
        }
      }
      sets.push({ start: currentStart, end: stretchEnd, name });
    }
    currentStart = h.end;
  }

  if (duration - currentStart >= 120) {
    sets.push({ start: currentStart, end: duration, name: "" });
  }

  return sets;
}

export function setAt(sets: PerformerSet[], time: number): number {
  for (let i = 0; i < sets.length; i++) {
    if (sets[i].start <= time && time < sets[i].end) {
      return i;
    }
  }
  let lastIdx = -1;
  for (let i = 0; i < sets.length; i++) {
    if (sets[i].start <= time) {
      lastIdx = i;
    }
  }
  return lastIdx;
}

export function oneEach<T extends { id: string; start: number; score: number }>(
  laughs: T[],
  sets: PerformerSet[],
): string[] {
  const result: string[] = [];
  for (const set of sets) {
    let bestId: string | null = null;
    let bestScore = -Infinity;
    for (const laugh of laughs) {
      if (laugh.start >= set.start && laugh.start < set.end) {
        if (laugh.score > bestScore) {
          bestScore = laugh.score;
          bestId = laugh.id;
        }
      }
    }
    if (bestId !== null) {
      result.push(bestId);
    }
  }
  return result;
}
