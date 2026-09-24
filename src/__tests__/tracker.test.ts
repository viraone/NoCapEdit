import { describe, expect, it } from "vitest";
import { matchTemplate, ncc } from "@/lib/tracking/templateTracker";
import { positionAt } from "@/lib/models/project";

describe("template matching", () => {
  it("finds a shifted patch", () => {
    const w = 64;
    const h = 64;
    const img = new Float32Array(w * h);
    // A bright blob centred at (20, 30)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) img[y * w + x] = Math.exp(-((x - 20) ** 2 + (y - 30) ** 2) / 20);
    const half = 5;
    const size = half * 2 + 1;
    const template = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) template[y * size + x] = img[(30 - half + y) * w + (20 - half + x)];
    const m = matchTemplate(img, w, h, template, half, 24, 26, 8);
    expect(m.x).toBe(20);
    expect(m.y).toBe(30);
    expect(m.score).toBeGreaterThan(0.99);
    expect(ncc(template, template)).toBeCloseTo(1, 5);
  });
});

describe("positionAt", () => {
  it("interpolates and clamps", () => {
    const kf = [
      { t: 0, x: 0, y: 0 },
      { t: 2, x: 1, y: 0.5 },
    ];
    expect(positionAt(kf, -1)).toEqual({ x: 0, y: 0 });
    expect(positionAt(kf, 1)).toEqual({ x: 0.5, y: 0.25 });
    expect(positionAt(kf, 5)).toEqual({ x: 1, y: 0.5 });
  });
});
