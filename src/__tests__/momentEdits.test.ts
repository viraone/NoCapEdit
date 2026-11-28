import { describe, expect, it } from "vitest";
import {
  editPieces,
  keptRanges,
  nudge,
  setCut,
  type MomentEdit,
} from "@/lib/recap/momentEdits";

describe("nudge", () => {
  const edit: MomentEdit = { start: 10, end: 20, cut: null };

  it("nudges start and clamps to [0, end - 1]", () => {
    expect(nudge(edit, "start", 2, 100).start).toBeCloseTo(12);
    expect(nudge(edit, "start", -50, 100).start).toBeCloseTo(0);
    expect(nudge(edit, "start", 50, 100).start).toBeCloseTo(19);
  });

  it("nudges end and clamps to [start + 1, duration]", () => {
    expect(nudge(edit, "end", 2, 100).end).toBeCloseTo(22);
    expect(nudge(edit, "end", -50, 100).end).toBeCloseTo(11);
    expect(nudge(edit, "end", 50, 25).end).toBeCloseTo(25);
  });

  it("drops the cut when an edge moves past it", () => {
    const withCut: MomentEdit = { start: 10, end: 20, cut: { start: 12, end: 15 } };
    expect(nudge(withCut, "start", 5, 100).cut).toBeNull();
    expect(nudge(withCut, "end", -5, 100).cut).toBeNull();
    expect(nudge(withCut, "start", 1, 100).cut).not.toBeNull();
  });
});

describe("setCut", () => {
  const edit: MomentEdit = { start: 10, end: 20, cut: null };

  it("orders and clamps the cut", () => {
    const r = setCut(edit, 18, 12);
    expect(r.cut).toEqual({ start: 12, end: 18 });
    const clamped = setCut(edit, 5, 30);
    expect(clamped.cut).toEqual({ start: 10.2, end: 19.8 });
  });

  it("gives null for a tiny cut", () => {
    expect(setCut(edit, 12, 12.1).cut).toBeNull();
  });
});

describe("editPieces", () => {
  it("returns one piece without a cut", () => {
    expect(editPieces({ start: 1, end: 5, cut: null })).toEqual([
      { start: 1, end: 5 },
    ]);
  });

  it("returns two pieces with a cut", () => {
    expect(editPieces({ start: 1, end: 5, cut: { start: 2, end: 3 } })).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 5 },
    ]);
  });
});

describe("keptRanges", () => {
  it("uses pieceFor when no edit is present", () => {
    const ranges = keptRanges(
      [{ id: "a", start: 100, end: 104 }],
      {},
      [],
      1000,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(96);
    expect(ranges[0].end).toBeCloseTo(102.9);
  });

  it("uses the edit when present", () => {
    const ranges = keptRanges(
      [{ id: "a", start: 100, end: 104 }],
      { a: { start: 5, end: 6, cut: null } },
      [],
      1000,
    );
    expect(ranges).toEqual([{ start: 5, end: 6 }]);
  });

  it("merges overlapping pieces from two laughs", () => {
    const ranges = keptRanges(
      [
        { id: "a", start: 100, end: 104 },
        { id: "b", start: 102, end: 106 },
      ],
      {},
      [],
      1000,
    );
    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBeCloseTo(96);
    expect(ranges[0].end).toBeCloseTo(104.9);
  });
});
