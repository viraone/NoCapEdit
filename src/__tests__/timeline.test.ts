import { describe, expect, it } from "vitest";
import { createClip } from "@/lib/models/project";
import { layoutClips, locateFrame, projectDuration, toProjectTime, toSourceTime } from "@/lib/models/timeline";
import { computePlacement } from "@/lib/models/placement";

const clip = (duration: number, extra: Partial<ReturnType<typeof createClip>> = {}) => ({
  ...createClip({ assetId: "a", name: "c", duration, width: 1920, height: 1080, hasAudio: true }),
  ...extra,
});

describe("timeline layout", () => {
  it("accounts for trimming and speed", () => {
    const c = clip(10, { inPoint: 2, outPoint: 8, speed: 2 });
    const [l] = layoutClips([c]);
    expect(l.duration).toBe(3);
    expect(toSourceTime(l, 1)).toBe(4);
    expect(toProjectTime(l, 5)).toBe(1.5);
  });

  it("overlaps clips by the transition length", () => {
    const a = clip(4, { transition: { type: "fade", duration: 1 } });
    const b = clip(4);
    const layouts = layoutClips([a, b]);
    expect(layouts[1].start).toBe(3);
    expect(layouts[1].transitionIn).toBe(1);
    expect(projectDuration([a, b])).toBe(7);
  });

  it("clamps transitions to half of the shorter clip", () => {
    const a = clip(4, { transition: { type: "fade", duration: 5 } });
    const b = clip(1);
    const layouts = layoutClips([a, b]);
    expect(layouts[0].transitionOut).toBe(0.5);
  });

  it("locates the outgoing clip during a transition", () => {
    const a = clip(4, { transition: { type: "wipeleft", duration: 1 } });
    const b = clip(4);
    const layouts = layoutClips([a, b]);
    const loc = locateFrame(layouts, 3.25)!;
    expect(loc.primary.index).toBe(1);
    expect(loc.secondary?.index).toBe(0);
    expect(loc.progress).toBeCloseTo(0.25);
    expect(locateFrame(layouts, 1)!.secondary).toBeNull();
  });
});

describe("placement", () => {
  it("cover-fits landscape sources into a vertical frame", () => {
    const p = computePlacement({ width: 1920, height: 1080 }, { zoom: 1, pan: { x: 0, y: 0 } }, { width: 1080, height: 1920 });
    expect(p.dh).toBe(1920);
    expect(p.dw).toBeCloseTo(3413.33, 1);
    expect(p.dx).toBeCloseTo((1080 - p.dw) / 2, 5);
  });
});
