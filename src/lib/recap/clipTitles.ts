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

// Words a name must never show, whatever was said on stage. Encoded so the source does not spell them out.
const INSIDE_A_WORD = atob("bmlnZyxmdWNrLGZhZ2dvdCxjdW50LHNoaXQscmV0YXJk").split(",");
const WHOLE_WORDS = new Set(atob("bmlnZ2EsZmFnLGZhZ3MsZHlrZSxkeWtlcyxraWtlLGtpa2VzLHNwaWMsc3BpY3MsY2hpbmssY2hpbmtzLGdvb2ssZ29va3Msd2V0YmFjayx3ZXRiYWNrcyx0cmFubnksdHJhbm5pZXMsY29vbixjb29ucyxkaWNrLGRpY2tzLGNvY2ssY29ja3MscHVzc3ksd2hvcmUsd2hvcmVzLHNsdXQsc2x1dHMsYml0Y2gsYml0Y2hlcyxhc3MsYXNzZXMsYXNzaG9sZSxhc3Nob2xlcyxyYXBlLHJhcGVkLHJhcGVzLHJhcGlzdCxwb3JuLGN1bQ==").split(","));

/** False for a name with a slur or profanity in it: such a name is not shown and not kept. */
export function isCleanTitle(title: string): boolean {
  const words = title.normalize("NFKD").toLowerCase().replace(/[^a-z\s-]/g, "").split(/[\s-]+/);
  return !words.some((w) => WHOLE_WORDS.has(w) || INSIDE_A_WORD.some((bad) => w.includes(bad)));
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
      if (title && title.trim().length > 0 && isCleanTitle(title)) {
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
