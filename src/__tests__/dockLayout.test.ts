import { describe, expect, it } from "vitest";
import {
  DOCK_DEFAULT_H,
  DOCK_MAX_H,
  DOCK_MIN_H,
  STAGE_MIN_H,
  VIDEO_DEFAULT_H,
  VIDEO_MAX_H,
  VIDEO_MIN_H,
  clampDockHeight,
  readStoredDockHeight,
  videoLaneHeight,
} from "@/components/timeline/dockLayout";

describe("timeline dock height", () => {
  it("defaults to the original fixed layout", () => {
    expect(DOCK_DEFAULT_H).toBe(236);
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
    g.window = { innerHeight: STAGE_MIN_H + 300 };
    try {
      expect(readStoredDockHeight(250)).toBe(250);
      mem.set("reelflow.timelineHeight", String(DOCK_MAX_H));
      expect(readStoredDockHeight()).toBe(300); // the window leaves only 300 px for the dock
      g.localStorage = { getItem: () => { throw new Error("blocked"); } };
      expect(readStoredDockHeight(260)).toBe(260);
    } finally {
      g.localStorage = saved.localStorage;
      g.window = saved.window;
    }
  });
});
