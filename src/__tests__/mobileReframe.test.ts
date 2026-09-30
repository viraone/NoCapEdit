import { describe, expect, it } from "vitest";
import { aspectOf, cropRect, DEFAULT_REFRAME, outputFrame, panBy, withZoom, type Reframe } from "@/lib/mobile/reframe";

const reel = (over: Partial<Reframe> = {}): Reframe => ({ format: "9:16", fx: 0.5, fy: 0.5, zoom: 1, ...over });

describe("mobile reframe", () => {
  it("original keeps the whole frame", () => {
    expect(cropRect(1920, 1080, DEFAULT_REFRAME)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(aspectOf("original", 1920, 1080)).toBeCloseTo(16 / 9);
  });

  it("crops a centred 9:16 window out of a landscape clip", () => {
    const r = cropRect(1920, 1080, reel());
    expect(r.h).toBeCloseTo(1080);
    expect(r.w).toBeCloseTo(607.5);
    expect(r.x).toBeCloseTo((1920 - 607.5) / 2);
    expect(r.y).toBeCloseTo(0);
  });

  it("zoom shrinks the window and opens vertical slack", () => {
    const r = cropRect(1920, 1080, reel({ zoom: 2, fy: 0 }));
    expect(r.w).toBeCloseTo(303.75);
    expect(r.h).toBeCloseTo(540);
    expect(r.y).toBeCloseTo(0);
    expect(cropRect(1920, 1080, reel({ zoom: 2, fy: 1 })).y).toBeCloseTo(540);
  });

  it("dragging right moves the window left, and clamps at the edge", () => {
    const moved = panBy(1920, 1080, reel(), 100, 0);
    expect(cropRect(1920, 1080, moved).x).toBeCloseTo((1920 - 607.5) / 2 - 100);
    const pinned = panBy(1920, 1080, reel(), 5000, 0);
    expect(pinned.fx).toBe(0);
    // No vertical slack at zoom 1: fy stays centred.
    expect(panBy(1920, 1080, reel(), 0, 300).fy).toBe(0.5);
  });

  it("clamps zoom to 1…4", () => {
    expect(withZoom(reel(), 0.2).zoom).toBe(1);
    expect(withZoom(reel(), 9).zoom).toBe(4);
  });

  it("sizes the output: no upscale for original, full reel from 1080p, capped from 4K", () => {
    expect(outputFrame(3840, 2160, DEFAULT_REFRAME)).toEqual({ width: 1920, height: 1080 });
    expect(outputFrame(1280, 720, DEFAULT_REFRAME)).toEqual({ width: 1280, height: 720 });
    expect(outputFrame(1920, 1080, reel())).toEqual({ width: 1080, height: 1920 });
    expect(outputFrame(3840, 2160, reel())).toEqual({ width: 1080, height: 1920 });
    expect(outputFrame(1920, 1080, reel({ format: "1:1" }))).toEqual({ width: 1080, height: 1080 });
    expect(outputFrame(3840, 2160, reel({ format: "4:5" }))).toEqual({ width: 1080, height: 1350 });
    // A small source is upscaled at most 2×.
    expect(outputFrame(640, 360, reel())).toEqual({ width: 406, height: 720 });
  });
});
