import { describe, expect, it } from "vitest";
import {
  defaultEdit,
  pieceAt,
  splitPiece,
  removePiece,
  resizePiece,
  editPieces,
  editLength,
  playStep,
  keptRanges,
  type MomentEdit,
} from "@/lib/recap/momentEdits";

describe("defaultEdit", () => {
  it("creates a single piece from pieceFor", () => {
    const edit = defaultEdit({ start: 10, end: 12 }, [], 100);
    expect(edit.pieces).toHaveLength(1);
    expect(edit.pieces[0].start).toBeCloseTo(6);
    expect(edit.pieces[0].end).toBeCloseTo(12.4);
  });
});

describe("pieceAt", () => {
  const edit: MomentEdit = {
    pieces: [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ],
  };

  it("finds the correct piece index", () => {
    expect(pieceAt(edit, 2)).toBe(0);
    expect(pieceAt(edit, 12)).toBe(1);
  });

  it("returns -1 for gaps and outside", () => {
    expect(pieceAt(edit, 7)).toBe(-1);
    expect(pieceAt(edit, -1)).toBe(-1);
    expect(pieceAt(edit, 20)).toBe(-1);
  });
});

describe("splitPiece", () => {
  const edit: MomentEdit = {
    pieces: [{ start: 0, end: 10 }],
  };

  it("splits a piece", () => {
    const result = splitPiece(edit, 5);
    expect(result).not.toBeNull();
    expect(result?.pieces).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 10 },
    ]);
  });

  it("returns null if t is not inside a piece", () => {
    expect(splitPiece(edit, 15)).toBeNull();
  });

  it("returns null if either half is too short", () => {
    expect(splitPiece(edit, 0.1)).toBeNull();
    expect(splitPiece(edit, 9.9)).toBeNull();
  });
});

describe("removePiece", () => {
  const edit: MomentEdit = {
    pieces: [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ],
  };

  it("removes a piece", () => {
    const result = removePiece(edit, 0);
    expect(result).not.toBeNull();
    expect(result?.pieces).toEqual([{ start: 10, end: 15 }]);
  });

  it("returns null for out of range index", () => {
    expect(removePiece(edit, 2)).toBeNull();
    expect(removePiece(edit, -1)).toBeNull();
  });

  it("returns null if it is the only piece", () => {
    const single: MomentEdit = { pieces: [{ start: 0, end: 5 }] };
    expect(removePiece(single, 0)).toBeNull();
  });
});

describe("resizePiece", () => {
  const edit: MomentEdit = {
    pieces: [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ],
  };

  it("resizes start edge with clamping", () => {
    // Move start of first piece left (clamped to 0)
    expect(resizePiece(edit, 0, "start", -5, 100).pieces[0].start).toBeCloseTo(0);
    // Move start of first piece right (clamped to end - MIN_PIECE)
    expect(resizePiece(edit, 0, "start", 10, 100).pieces[0].start).toBeCloseTo(4.8);
    // Move start of second piece left (clamped to prev end)
    expect(resizePiece(edit, 1, "start", 5, 100).pieces[1].start).toBeCloseTo(5);
    // Move start of second piece right (clamped to end - MIN_PIECE)
    expect(resizePiece(edit, 1, "start", 20, 100).pieces[1].start).toBeCloseTo(14.8);
  });

  it("resizes end edge with clamping", () => {
    // Move end of first piece right (clamped to next start)
    expect(resizePiece(edit, 0, "end", 20, 100).pieces[0].end).toBeCloseTo(10);
    // Move end of first piece left (clamped to start + MIN_PIECE)
    expect(resizePiece(edit, 0, "end", -5, 100).pieces[0].end).toBeCloseTo(0.2);
    // Move end of second piece right (clamped to duration)
    expect(resizePiece(edit, 1, "end", 20, 15).pieces[1].end).toBeCloseTo(15);
    // Move end of second piece left (clamped to start + MIN_PIECE)
    expect(resizePiece(edit, 1, "end", 5, 100).pieces[1].end).toBeCloseTo(10.2);
  });

  it("returns edit unchanged for out of range index", () => {
    expect(resizePiece(edit, 5, "start", 1, 100)).toBe(edit);
  });
});

describe("editPieces", () => {
  it("joins touching pieces", () => {
    const edit: MomentEdit = {
      pieces: [
        { start: 0, end: 5 },
        { start: 5, end: 10 },
      ],
    };
    expect(editPieces(edit)).toEqual([{ start: 0, end: 10 }]);
  });

  it("keeps separated pieces", () => {
    const edit: MomentEdit = {
      pieces: [
        { start: 0, end: 5 },
        { start: 6, end: 10 },
      ],
    };
    expect(editPieces(edit)).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
    ]);
  });
});

describe("editLength", () => {
  it("sums piece lengths", () => {
    const edit: MomentEdit = {
      pieces: [
        { start: 0, end: 5 },
        { start: 10, end: 12 },
      ],
    };
    expect(editLength(edit)).toBeCloseTo(7);
  });
});

describe("playStep", () => {
  const edit: MomentEdit = {
    pieces: [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ],
  };

  it("seeks to next piece in a gap", () => {
    expect(playStep(edit, 7)).toEqual({ seek: 10 });
  });

  it("pauses at the end", () => {
    expect(playStep(edit, 15)).toBe("pause");
    expect(playStep(edit, 15.4)).toBe("pause");
  });

  it("returns null elsewhere", () => {
    expect(playStep(edit, 2)).toBeNull();
    expect(playStep(edit, 16)).toBeNull();
    expect(playStep(edit, -1)).toBeNull();
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
      { a: { pieces: [{ start: 5, end: 6 }] } },
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
