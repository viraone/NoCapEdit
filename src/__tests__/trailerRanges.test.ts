import { describe, expect, it } from "vitest";
import { pieceFor, trailerRanges, totalLength } from "@/lib/recap/trailerRanges";

describe("trailerRanges", () => {
  it("1. no cues", () => {
    const r = pieceFor({ start: 100, end: 104 }, [], 1000);
    expect(r.start).toBeCloseTo(96);
    expect(r.end).toBeCloseTo(102.9);
  });

  it("2. cues with sentence end", () => {
    const cues = [
      { start: 90, end: 92, text: "Hello there." },
      { start: 95, end: 96.2, text: "So I went" },
      { start: 96.3, end: 98, text: "to the shop" },
      { start: 98.1, end: 99.8, text: "and they said no" },
    ];
    const r = pieceFor({ start: 100, end: 100.5 }, cues, 1000);
    expect(r.end).toBeCloseTo(100.9);
    expect(r.start).toBeCloseTo(95);
  });

  it("3. same cues, longer laugh", () => {
    const cues = [
      { start: 90, end: 92, text: "Hello there." },
      { start: 95, end: 96.2, text: "So I went" },
      { start: 96.3, end: 98, text: "to the shop" },
      { start: 98.1, end: 99.8, text: "and they said no" },
    ];
    const r = pieceFor({ start: 100, end: 103 }, cues, 1000);
    expect(r.end).toBeCloseTo(102.9);
    expect(r.start).toBeCloseTo(96.3);
  });

  it("4. pause break", () => {
    const cues = [
      { start: 90, end: 91, text: "uh" },
      { start: 97, end: 99.5, text: "the punchline" },
    ];
    const r = pieceFor({ start: 100, end: 103 }, cues, 1000);
    expect(r.start).toBeCloseTo(97);
    expect(r.end).toBeCloseTo(102.9);
  });

  it("5. short gap", () => {
    const cues = [{ start: 99.5, end: 99.9, text: "no" }];
    const r = pieceFor({ start: 100, end: 100.5 }, cues, 1000);
    expect(r.start).toBeCloseTo(97.9);
    expect(r.end).toBeCloseTo(100.9);
  });

  it("6. early laugh", () => {
    const r = pieceFor({ start: 1, end: 2 }, [], 1000);
    expect(r.start).toBeCloseTo(0);
    expect(r.end).toBeCloseTo(3);
  });

  it("7. trailerRanges merge", () => {
    const laughs = [
      { start: 200, end: 203 },
      { start: 100, end: 104 },
      { start: 101, end: 104 },
    ];
    const original = [...laughs];
    const ranges = trailerRanges(laughs, [], 1000);
    expect(ranges.length).toBe(2);
    expect(ranges[0].start).toBeCloseTo(96);
    expect(ranges[0].end).toBeCloseTo(103.9);
    expect(ranges[1].start).toBeCloseTo(196);
    expect(ranges[1].end).toBeCloseTo(202.9);
    expect(totalLength(ranges)).toBeCloseTo(14.8);
    expect(laughs).toEqual(original);
  });
});
