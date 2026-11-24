import { describe, expect, it } from "vitest";
import { clampPan, computePlacement, panLimit } from "@/lib/models/placement";

const frame = { width: 1080, height: 1920 };
const source = { width: 1920, height: 1080 };

describe("panLimit", () => {
  it("a wide video in a tall frame can move sideways but not up or down", () => {
    const lim = panLimit(source, 1, frame);
    expect(lim.y).toBeCloseTo(0, 6);
    expect(lim.x).toBeCloseTo((1920 * (1920 / 1080) - 1080) / 2 / 1080, 6);
  });

  it("gives finite numbers for a source with no size yet", () => {
    const lim = panLimit({ width: 0, height: 0 }, 1, frame);
    expect(Number.isFinite(lim.x)).toBe(true);
    expect(Number.isFinite(lim.y)).toBe(true);
  });
});

describe("clampPan", () => {
  it("leaves a pan inside the limit alone", () => {
    expect(clampPan({ x: 0.2, y: 0 }, source, 1, frame)).toEqual({ x: 0.2, y: 0 });
  });
});

describe("computePlacement", () => {
  it("cannot be pushed down to leave black at the top", () => {
    const p = computePlacement(source, { zoom: 1, pan: { x: 0, y: 0.3 } }, frame);
    expect(p.dy).toBeCloseTo(0, 6);
    expect(p.dy + p.dh).toBeCloseTo(1920, 6);
  });

  it("stops at the picture's left and right edges", () => {
    expect(computePlacement(source, { zoom: 1, pan: { x: 5, y: 0 } }, frame).dx).toBeCloseTo(0, 6);
    const p = computePlacement(source, { zoom: 1, pan: { x: -5, y: 0 } }, frame);
    expect(p.dx + p.dw).toBeCloseTo(1080, 6);
  });

  it("zoomed out: still covers the width, and stays inside the height", () => {
    for (const pan of [{ x: 3, y: 3 }, { x: -3, y: -3 }]) {
      const p = computePlacement(source, { zoom: 0.5, pan }, frame);
      expect(p.dx).toBeLessThanOrEqual(1e-6);
      expect(p.dx + p.dw).toBeGreaterThanOrEqual(1080 - 1e-6);
      expect(p.dy).toBeGreaterThanOrEqual(-1e-6);
      expect(p.dy + p.dh).toBeLessThanOrEqual(1920 + 1e-6);
    }
  });

  it("zoomed far out: the whole picture stays inside the frame", () => {
    const p = computePlacement(source, { zoom: 0.5, pan: { x: 3, y: -3 } }, { width: 1920, height: 1080 });
    expect(p.dx + p.dw).toBeCloseTo(1920, 6);
    expect(p.dy).toBeCloseTo(0, 6);
  });
});
