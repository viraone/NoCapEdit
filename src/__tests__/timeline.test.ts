import { describe, expect, it } from "vitest";
import { createClip } from "@/lib/models/project";
import { layoutClips, locateFrame, projectDuration, toProjectTime, toSourceTime } from "@/lib/models/timeline";
import { computePlacement } from "@/lib/models/placement";
import * as clipOpsModule from "@/lib/models/clipOps";
import { createProject } from "@/lib/models/project";

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

describe("reorderClip", () => {
  it("moves a clip to a new position in the sequence", async () => {
    const { reorderClip } = await import("@/lib/models/clipOps");
    const { createProject } = await import("@/lib/models/project");
    const p = createProject({ name: "t" });
    p.clips = [clip(1, { id: "a" }), clip(1, { id: "b" }), clip(1, { id: "c" }), clip(1, { id: "d" })];
    expect(reorderClip(p, "d", 0)).toBe(true);
    expect(p.clips.map((c) => c.id)).toEqual(["d", "a", "b", "c"]);
    expect(reorderClip(p, "d", 2)).toBe(true);
    expect(p.clips.map((c) => c.id)).toEqual(["a", "b", "d", "c"]);
    expect(reorderClip(p, "a", 0)).toBe(false);
    expect(reorderClip(p, "zzz", 0)).toBe(false);
    expect(reorderClip(p, "a", 99)).toBe(true);
    expect(p.clips.map((c) => c.id)).toEqual(["b", "d", "c", "a"]);
  });
});


describe("clip cuts and splits at edges and inside transitions", () => {
  const { cutAfter, cutBefore, splitClipAt } = clipOpsModule;
  const project = () => createProject({ clips: [clip(8, { transition: { type: "fade", duration: 1 } }), clip(8)] });

  it("refuses zero-length cuts at the clip edges", () => {
    const p = project();
    expect(cutBefore(p, 0)).toBe(false);
    expect(cutAfter(p, 15)).toBe(false); // project end: 8 + 8 - 1
    expect(p.clips.map((c) => [c.inPoint, c.outPoint])).toEqual([[0, 8], [0, 8]]);
  });

  it("cuts the outgoing clip when the playhead is inside a dissolve", () => {
    const p = project();
    expect(cutAfter(p, 7.25)).toBe(true); // overlap runs 7..8
    expect(p.clips[0].outPoint).toBeCloseTo(7.25);
    expect(p.clips[1].outPoint).toBe(8);
  });

  it("trims the incoming clip's head with cut before inside a dissolve", () => {
    const p = project();
    expect(cutBefore(p, 7.25)).toBe(true);
    expect(p.clips[1].inPoint).toBeCloseTo(0.25);
    expect(p.clips[0].outPoint).toBe(8);
  });

  it("refuses to split inside a dissolve and still splits just past it", () => {
    const p = project();
    expect(splitClipAt(p, 7.5)).toBeNull();
    expect(p.clips).toHaveLength(2);
    expect(splitClipAt(p, 9)).not.toBeNull();
    expect(p.clips).toHaveLength(3);
  });
});
