import { describe, expect, it } from "vitest";
import {
  batches,
  isCleanTitle,
  matchTitles,
  momentText,
  titleKey,
  type Span,
  type TimedText,
} from "@/lib/recap/clipTitles";

describe("momentText", () => {
  const laugh: Span = { start: 10, end: 12 };

  it("excludes cues before the lead window", () => {
    const cues: TimedText[] = [
      { start: 0, end: 5, text: "too early" },
      { start: 8, end: 9, text: "in window" },
      { start: 10, end: 11, text: "during" },
    ];
    expect(momentText(laugh, cues, 2)).toBe("in window during");
  });

  it("excludes cues after the laugh", () => {
    const cues: TimedText[] = [
      { start: 9, end: 10, text: "before" },
      { start: 12, end: 13, text: "after" },
    ];
    expect(momentText(laugh, cues, 2)).toBe("before");
  });

  it("sorts cues by start", () => {
    const cues: TimedText[] = [
      { start: 10, end: 11, text: "second" },
      { start: 8, end: 9, text: "first" },
    ];
    expect(momentText(laugh, cues, 2)).toBe("first second");
  });

  it("trims and joins with single spaces", () => {
    const cues: TimedText[] = [
      { start: 8, end: 9, text: "  hello  " },
      { start: 10, end: 11, text: " world " },
    ];
    expect(momentText(laugh, cues, 2)).toBe("hello world");
  });

  it("returns empty string when no cues match", () => {
    const cues: TimedText[] = [{ start: 0, end: 1, text: "far away" }];
    expect(momentText(laugh, cues, 2)).toBe("");
  });

  it("cuts at a word boundary when exceeding max", () => {
    const cues: TimedText[] = [
      { start: 8, end: 9, text: "one two three four five" },
    ];
    const result = momentText(laugh, cues, 2, 10);
    expect(result).toBe("four five");
  });

  it("keeps last max chars and drops partial first word", () => {
    const cues: TimedText[] = [
      { start: 8, end: 9, text: "abcdefghij klmnop" },
    ];
    const result = momentText(laugh, cues, 2, 10);
    expect(result).toBe("klmnop");
  });
});

describe("titleKey", () => {
  it("rounds start to nearest integer", () => {
    expect(titleKey({ start: 10.4, end: 12 })).toBe("10");
    expect(titleKey({ start: 10.5, end: 12 })).toBe("11");
    expect(titleKey({ start: 10.6, end: 12 })).toBe("11");
  });
});

describe("matchTitles", () => {
  it("matches within 2 seconds", () => {
    const laughs: Array<Span & { id: string }> = [
      { id: "a", start: 10, end: 12 },
    ];
    const saved = { "11": "Title A" };
    expect(matchTitles(laughs, saved)).toEqual({ a: "Title A" });
  });

  it("does not match beyond 2 seconds", () => {
    const laughs: Array<Span & { id: string }> = [
      { id: "a", start: 10, end: 12 },
    ];
    const saved = { "13": "Title A" };
    expect(matchTitles(laughs, saved)).toEqual({});
  });

  it("picks the closest key", () => {
    const laughs: Array<Span & { id: string }> = [
      { id: "a", start: 10, end: 12 },
    ];
    const saved = { "8": "Far", "11": "Close" };
    expect(matchTitles(laughs, saved)).toEqual({ a: "Close" });
  });

  it("ignores empty titles", () => {
    const laughs: Array<Span & { id: string }> = [
      { id: "a", start: 10, end: 12 },
    ];
    const saved = { "10": "" };
    expect(matchTitles(laughs, saved)).toEqual({});
  });
});

describe("batches", () => {
  it("splits into groups of size", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns empty array for empty input", () => {
    expect(batches([], 3)).toEqual([]);
  });

  it("returns single batch when size >= length", () => {
    expect(batches([1, 2], 5)).toEqual([[1, 2]]);
  });
});

describe("isCleanTitle", () => {
  const bad = atob("bmlnZ2EsRnVja2luZyxidWxsLXNoaXQsRmFncyxBIERpY2sgSm9rZQ==").split(",");

  it("refuses slurs and profanity, in any case and inside a longer word", () => {
    for (const word of bad) expect(isCleanTitle(`Story about ${word} today`)).toBe(false);
  });

  it("lets ordinary names through, including ones that only look close", () => {
    for (const title of ["Algebra Teacher Phone Call", "Cockroach In The Class", "Assistant Raccoon Grape", "Dickens Reading Night"]) {
      expect(isCleanTitle(title)).toBe(true);
    }
  });

  it("keeps a saved name with such a word off the card", () => {
    expect(matchTitles([{ id: "a", start: 10, end: 12 }], { "10": `The ${bad[0]}` })).toEqual({});
  });
});
