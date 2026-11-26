import { describe, expect, it } from "vitest";
import { COVER_FRAMES, sampleTimes, brightness, candidates, squareCrop } from "@/lib/phone/coverFrames";

describe("sampleTimes", () => {
  it("returns [0] for invalid duration", () => {
    expect(sampleTimes(0)).toEqual([0]);
    expect(sampleTimes(-1)).toEqual([0]);
    expect(sampleTimes(NaN)).toEqual([0]);
    expect(sampleTimes(Infinity)).toEqual([0]);
  });

  it("returns default count of 8 samples", () => {
    const times = sampleTimes(10);
    expect(times.length).toBe(COVER_FRAMES);
    // (0.5)*10/8 = 0.625, (1.5)*10/8 = 1.875, ...
    expect(times[0]).toBe(0.625);
    expect(times[1]).toBe(1.875);
    expect(times[7]).toBe(9.375);
  });

  it("clamps count to 1..10", () => {
    expect(sampleTimes(10, 0).length).toBe(1);
    expect(sampleTimes(10, -5).length).toBe(1);
    expect(sampleTimes(10, 11).length).toBe(10);
    expect(sampleTimes(10, 100).length).toBe(10);
  });

  it("uses COVER_FRAMES for non-finite count", () => {
    expect(sampleTimes(10, NaN).length).toBe(COVER_FRAMES);
    expect(sampleTimes(10, Infinity).length).toBe(COVER_FRAMES);
  });

  it("rounds to 3 decimals", () => {
    const times = sampleTimes(1, 3);
    // (0.5)*1/3 = 0.1666... -> 0.167
    // (1.5)*1/3 = 0.5
    // (2.5)*1/3 = 0.8333... -> 0.833
    expect(times).toEqual([0.167, 0.5, 0.833]);
  });
});

describe("brightness", () => {
  it("returns 0 for empty array", () => {
    expect(brightness(new Uint8Array([]))).toBe(0);
    expect(brightness(new Uint8ClampedArray([]))).toBe(0);
  });

  it("calculates mean brightness correctly", () => {
    // One pixel: R=255, G=0, B=0 -> 0.2126*255 = 54.213
    const px = new Uint8Array([255, 0, 0, 255]);
    expect(brightness(px)).toBeCloseTo(54.213, 3);

    // Two pixels: (255,0,0) and (0,255,0)
    // 0.2126*255 + 0.7152*255 = 54.213 + 182.376 = 236.589
    // Mean = 236.589 / 2 = 118.2945
    const px2 = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(brightness(px2)).toBeCloseTo(118.2945, 3);
  });

  it("ignores trailing partial pixel", () => {
    // 1 full pixel + 3 bytes
    const px = new Uint8Array([255, 0, 0, 255, 100, 100, 100]);
    expect(brightness(px)).toBeCloseTo(54.213, 3);
  });
});

describe("candidates", () => {
  it("returns [] for empty input", () => {
    expect(candidates([])).toEqual([]);
  });

  it("returns frames with brightness >= DARK_BRIGHTNESS", () => {
    const frames = [
      { brightness: 10 },
      { brightness: 18 },
      { brightness: 20 },
      { brightness: 5 },
    ];
    expect(candidates(frames)).toEqual([
      { brightness: 18 },
      { brightness: 20 },
    ]);
  });

  it("returns brightest frame if none are bright enough", () => {
    const frames = [
      { brightness: 5 },
      { brightness: 10 },
      { brightness: 8 },
    ];
    expect(candidates(frames)).toEqual([{ brightness: 10 }]);
  });

  it("returns first brightest on tie", () => {
    const frames = [
      { brightness: 10, id: 1 },
      { brightness: 10, id: 2 },
    ];
    expect(candidates(frames)).toEqual([{ brightness: 10, id: 1 }]);
  });
});

describe("squareCrop", () => {
  it("handles portrait image (height > width)", () => {
    expect(squareCrop(1080, 1920, 0.5)).toEqual({ x: 0, y: 420, size: 1080 });
    expect(squareCrop(1080, 1920, 0)).toEqual({ x: 0, y: 0, size: 1080 });
    expect(squareCrop(1080, 1920, 1)).toEqual({ x: 0, y: 840, size: 1080 });
  });

  it("handles landscape image (width > height)", () => {
    expect(squareCrop(1920, 1080, 0.5)).toEqual({ x: 420, y: 0, size: 1080 });
  });

  it("handles square image", () => {
    expect(squareCrop(500, 500, 0.9)).toEqual({ x: 0, y: 0, size: 500 });
  });

  it("clamps center to 0..1", () => {
    expect(squareCrop(1080, 1920, -1)).toEqual({ x: 0, y: 0, size: 1080 });
    expect(squareCrop(1080, 1920, 2)).toEqual({ x: 0, y: 840, size: 1080 });
  });

  it("uses 0.5 for non-finite center", () => {
    expect(squareCrop(1080, 1920, NaN)).toEqual({ x: 0, y: 420, size: 1080 });
    expect(squareCrop(1080, 1920, Infinity)).toEqual({ x: 0, y: 420, size: 1080 });
  });
});
