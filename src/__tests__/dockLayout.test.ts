import { describe, expect, it } from "vitest";
import {
  DOCK_DEFAULT_H,
  DOCK_MAX_H,
  DOCK_MIN_H,
  MAX_STRIP_PX,
  STAGE_MIN_H,
  STRIP_OVERSCAN,
  VIDEO_DEFAULT_H,
  VIDEO_MAX_H,
  VIDEO_MIN_H,
  clampDockHeight,
  drawRange,
  readStoredDockHeight,
  stripScale,
  videoLaneHeight,
  visibleWindow,
} from "@/components/timeline/dockLayout";

describe("strip draw windows", () => {
  it("draws the viewport plus the overscan, never before the timeline start", () => {
    expect(drawRange(0, 1000)).toEqual({ from: 0, to: 1000 + STRIP_OVERSCAN });
    expect(drawRange(5000, 1000)).toEqual({ from: 5000 - STRIP_OVERSCAN, to: 6000 + STRIP_OVERSCAN });
  });

  it("cuts a block to the drawn range on whole pixels, empty when it is off screen", () => {
    const view = { from: 4400, to: 7600 };
    expect(visibleWindow(0, 48880, view)).toEqual({ x0: 4400, x1: 7600 });
    expect(visibleWindow(4000.5, 1000, view)).toEqual({ x0: 399, x1: 1000 });
    expect(visibleWindow(5000, 100, view)).toEqual({ x0: 0, x1: 100 });
    const before = visibleWindow(0, 3000, view);
    expect(before.x1).toBeLessThanOrEqual(before.x0);
    const after = visibleWindow(9000, 3000, view);
    expect(after.x1).toBeLessThanOrEqual(after.x0);
  });

  it("keeps a strip canvas under the size browsers accept", () => {
    expect(stripScale(2000, 2)).toBe(2);
    expect(stripScale(2000, 3)).toBe(2);
    expect(stripScale(2000, 0)).toBe(1);
    expect(stripScale(10000, 2) * 10000).toBeCloseTo(MAX_STRIP_PX, 6);
    // A 10-minute clip at the default zoom on a 2x display, were it drawn whole.
    expect(stripScale(48880, 2) * 48880).toBeLessThanOrEqual(MAX_STRIP_PX);
  });
});

describe("timeline dock height", () => {
  it("defaults to the original fixed layout", () => {
    expect(DOCK_DEFAULT_H).toBe(312);
    expect(videoLaneHeight(DOCK_DEFAULT_H)).toBe(VIDEO_DEFAULT_H);
  });

  it("clamps to the lane limits and rounds to whole pixels", () => {
    expect(clampDockHeight(0)).toBe(DOCK_MIN_H);
    expect(clampDockHeight(10_000)).toBe(DOCK_MAX_H);
    expect(clampDockHeight(300.4)).toBe(300);
    expect(clampDockHeight(NaN)).toBe(DOCK_DEFAULT_H);
    expect(videoLaneHeight(DOCK_MIN_H)).toBe(VIDEO_MIN_H);
    expect(videoLaneHeight(DOCK_MAX_H)).toBe(VIDEO_MAX_H);
  });

  it("leaves the preview its minimum height on short windows", () => {
    expect(clampDockHeight(DOCK_MAX_H, STAGE_MIN_H + 300)).toBe(300);
    // A window too short for even the smallest dock still gets the smallest dock.
    expect(clampDockHeight(DOCK_MAX_H, 100)).toBe(DOCK_MIN_H);
  });
});

describe("readStoredDockHeight", () => {
  it("clamps the stored height to the live window, falling back when storage is empty or unavailable", () => {
    const mem = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown; window?: unknown };
    const saved = { localStorage: g.localStorage, window: g.window };
    g.localStorage = { getItem: (k: string) => mem.get(k) ?? null };
    g.window = { innerHeight: STAGE_MIN_H + 320 };
    try {
      expect(readStoredDockHeight(280)).toBe(280);
      mem.set("reelflow.timelineHeight", String(DOCK_MAX_H));
      expect(readStoredDockHeight()).toBe(320); // the window leaves only 320 px for the dock
      g.localStorage = { getItem: () => { throw new Error("blocked"); } };
      expect(readStoredDockHeight(260)).toBe(260);
    } finally {
      g.localStorage = saved.localStorage;
      g.window = saved.window;
    }
  });
});
