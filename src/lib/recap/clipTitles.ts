export interface Span {
  start: number;
  end: number;
}

export interface TimedText {
  start: number;
  end: number;
  text: string;
}

export function momentText(
  laugh: Span,
  cues: TimedText[],
  lead = 25,
  max = 900,
): string {
  const selected = cues
    .filter((cue) => cue.end > laugh.start - lead && cue.start < laugh.end)
    .sort((a, b) => a.start - b.start)
    .map((cue) => cue.text.trim())
    .filter((text) => text.length > 0);

  const joined = selected.join(" ");

  if (joined.length <= max) {
    return joined;
  }

  const cut = joined.slice(joined.length - max);
  const spaceIndex = cut.indexOf(" ");
  if (spaceIndex === -1) {
    return cut;
  }
  return cut.slice(spaceIndex + 1);
}

export function titleKey(laugh: Span): string {
  return String(Math.round(laugh.start));
}

export function matchTitles(
  laughs: Array<Span & { id: string }>,
  saved: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  const keys = Object.keys(saved);

  for (const laugh of laughs) {
    let bestKey: string | null = null;
    let bestDiff = Infinity;

    for (const key of keys) {
      const keyNum = Number(key);
      if (Number.isNaN(keyNum)) {
        continue;
      }
      const diff = Math.abs(keyNum - laugh.start);
      if (diff <= 2 && diff < bestDiff) {
        bestDiff = diff;
        bestKey = key;
      }
    }

    if (bestKey !== null) {
      const title = saved[bestKey];
      if (title && title.trim().length > 0) {
        result[laugh.id] = title;
      }
    }
  }

  return result;
}

export function batches<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}
