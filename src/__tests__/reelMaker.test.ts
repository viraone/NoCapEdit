import { describe, expect, it } from "vitest";
import { cuesForRange, overlapsExisting, padRange, reelName } from "@/lib/edit/reelMaker";
import type { CaptionCue } from "@/lib/models/project";

const cue = (id: string, start: number, end: number, words?: [number, number][]): CaptionCue =>
  ({ id, text: id, start, end, words: words?.map(([s, e]) => ({ text: "w", start: s, end: e })) }) as unknown as CaptionCue;

describe("reel maker helpers", () => {
  it("pads a range with air inside the timeline", () => {
    expect(padRange(10, 40, 300)).toEqual({ start: 9.6, end: 40.4 });
    expect(padRange(0.2, 299.8, 300)).toEqual({ start: 0, end: 300 });
  });

  it("shifts and clips the cues inside the range, with fresh ids", () => {
    const cues = [cue("a", 0, 5), cue("b", 9, 12, [[9, 10], [11, 12]]), cue("c", 20, 31), cue("d", 40, 50)];
    const out = cuesForRange(cues, 10, 30);
    expect(out.map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [10, 20],
    ]);
    expect(out[0].words?.map((w) => [w.start, w.end])).toEqual([
      [0, 0],
      [1, 2],
    ].filter(([s, e]) => e > s));
    expect(out.every((c) => !["a", "b", "c", "d"].includes(c.id))).toBe(true);
  });

  it("skips a range that mostly repeats an existing reel", () => {
    const existing = [{ start: 100, end: 130 }];
    expect(overlapsExisting(105, 135, existing)).toBe(true);
    expect(overlapsExisting(120, 150, existing)).toBe(false);
    expect(overlapsExisting(200, 230, existing)).toBe(false);
  });

  it("names reels after the source, index and title", () => {
    expect(reelName("Suitman show", 3, "  The heckler   bit ")).toBe("Suitman show · Reel 3 · The heckler bit");
    expect(reelName("Show", 1, "")).toBe("Show · Reel 1 · Untitled");
  });
});
