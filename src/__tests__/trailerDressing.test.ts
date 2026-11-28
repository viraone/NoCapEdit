import { describe, expect, it } from "vitest";
import type { CaptionCue } from "@/lib/models/project";
import { oneWordCues, trailerOverlays, type TrailerPiece } from "@/lib/recap/trailerDressing";

function cue(start: number, end: number, text: string, words?: { text: string; start: number; end: number }[]): CaptionCue {
  return { id: `c${start}`, start, end, text, words };
}

describe("oneWordCues", () => {
  it("gives one cue per word for a cue with words", () => {
    const cues = [cue(0, 1, "hello world", [
      { text: "hello", start: 0, end: 0.4 },
      { text: "world", start: 0.5, end: 1 },
    ])];
    const out = oneWordCues(cues);
    expect(out.map((c) => c.text)).toEqual(["hello", "world"]);
    expect(out.every((c) => c.words?.length === 1)).toBe(true);
  });

  it("gives one cue per word for a cue without words, in order", () => {
    const cues = [cue(0, 3, "a b c")];
    const out = oneWordCues(cues);
    expect(out.map((c) => c.text)).toEqual(["a", "b", "c"]);
    expect(out[0].start).toBeLessThan(out[1].start);
    expect(out[1].start).toBeLessThan(out[2].start);
  });

  it("returns [] for no cues", () => {
    expect(oneWordCues([])).toEqual([]);
  });
});

describe("trailerOverlays", () => {
  it("joins names across neighbouring pieces", () => {
    const pieces: TrailerPiece[] = [
      { start: 0, end: 1, name: "Alice" },
      { start: 1, end: 2, name: "Alice" },
      { start: 2, end: 3, name: "Bob" },
    ];
    const out = trailerOverlays(pieces, "");
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe("Alice");
    expect(out[0].start).toBe(0);
    expect(out[0].end).toBe(2);
    expect(out[1].text).toBe("Bob");
  });

  it("empty names give no tag", () => {
    const pieces: TrailerPiece[] = [{ start: 0, end: 1, name: "  " }];
    expect(trailerOverlays(pieces, "")).toHaveLength(0);
  });

  it("closing line spans the last piece", () => {
    const pieces: TrailerPiece[] = [
      { start: 0, end: 1, name: "Alice" },
      { start: 1, end: 2, name: "Bob" },
    ];
    const out = trailerOverlays(pieces, "  The End  ");
    const closing = out[out.length - 1];
    expect(closing.text).toBe("The End");
    expect(closing.start).toBe(1);
    expect(closing.end).toBe(2);
  });

  it("blank closing adds nothing", () => {
    const pieces: TrailerPiece[] = [{ start: 0, end: 1, name: "Alice" }];
    expect(trailerOverlays(pieces, "   ")).toHaveLength(1);
  });
});
