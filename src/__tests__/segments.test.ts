import { describe, expect, it } from "vitest";
import { createClip } from "@/lib/models/project";
import { layoutClips, projectDuration } from "@/lib/models/timeline";
import { planSegments, segmentGrid } from "@/lib/ffmpeg/segments";

const clip = (duration: number, extra = {}) => ({ ...createClip({ assetId: "a", name: "c", duration, width: 1920, height: 1080, hasAudio: true }), ...extra });

describe("planSegments", () => {
  it("returns one segment for short projects", () => {
    const segs = planSegments([clip(10)], 20);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ start: 0, end: 10 });
  });

  it("splits a long single clip and keeps the total duration", () => {
    const segs = planSegments([clip(65, { speed: 2, inPoint: 5 })], 10);
    expect(segs.length).toBeGreaterThan(2);
    const sum = segs.reduce((s, seg) => s + projectDuration(seg.clips), 0);
    expect(sum).toBeCloseTo(30, 4);
    for (const seg of segs) {
      expect(projectDuration(seg.clips)).toBeCloseTo(seg.end - seg.start, 4);
      expect(seg.clips[0].inPoint).toBeCloseTo(5 + seg.start * 2, 4);
    }
  });

  it("never cuts inside a transition", () => {
    const a = clip(12, { transition: { type: "fade", duration: 1 } });
    const b = clip(12, { transition: { type: "wipeleft", duration: 1 } });
    const c = clip(12);
    const clips = [a, b, c];
    const layouts = layoutClips(clips);
    const segs = planSegments(clips, 10);
    const total = projectDuration(clips);
    expect(segs[segs.length - 1].end).toBeCloseTo(total, 6);
    for (const seg of segs) {
      for (const l of layouts) {
        if (l.transitionIn > 0) {
          const inTransition = seg.start > l.start - 1e-6 && seg.start < l.start + l.transitionIn + 1e-6;
          expect(inTransition).toBe(false);
        }
      }
      expect(projectDuration(seg.clips)).toBeCloseTo(seg.end - seg.start, 4);
    }
  });

  it("prefers exact clip boundaries when there is no transition", () => {
    const clips = [clip(10), clip(10), clip(10)];
    const segs = planSegments(clips, 10);
    expect(segs.map((s) => [s.start, s.end])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(segs[1].clips).toHaveLength(1);
  });
});

describe("segmentGrid", () => {
  it("is a whole number of video frames and of AAC frames", () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      const g = segmentGrid(fps);
      expect(Math.abs(g * fps - Math.round(g * fps))).toBeLessThan(1e-9);
      expect(Math.abs((g * 48000) / 1024 - Math.round((g * 48000) / 1024))).toBeLessThan(1e-9);
    }
    expect(segmentGrid(30)).toBeCloseTo(25600 / 48000, 12);
    expect(segmentGrid(60)).toBeCloseTo(25600 / 48000, 12);
    expect(segmentGrid(24)).toBeCloseTo(128000 / 48000, 12);
    expect(segmentGrid(29.97)).toBeCloseTo(1 / 29.97, 12);
  });
});

describe("planSegments with a grid", () => {
  const grid = segmentGrid(30);
  it("snaps every cut onto the grid and keeps the total", () => {
    const clips = [clip(10), clip(10), clip(10)];
    const segs = planSegments(clips, 10, { grid });
    expect(segs.length).toBeGreaterThan(1);
    for (const seg of segs.slice(1)) {
      const units = seg.start / grid;
      expect(Math.abs(units - Math.round(units))).toBeLessThan(1e-6);
      expect(Math.abs((seg.start * 48000) / 1024 - Math.round((seg.start * 48000) / 1024))).toBeLessThan(1e-6);
    }
    expect(segs[segs.length - 1].end).toBeCloseTo(30, 6);
    for (const seg of segs) expect(projectDuration(seg.clips)).toBeCloseTo(seg.end - seg.start, 4);
    expect(segs.map((s) => s.start).length).toBe(3);
    expect(segs[1].start).toBeCloseTo(9.6, 9);
    expect(segs[2].start).toBeCloseTo(19.2, 9);
  });

  it("still never cuts inside a transition", () => {
    const a = clip(12, { transition: { type: "fade", duration: 1 } });
    const b = clip(12, { transition: { type: "wipeleft", duration: 1 } });
    const c = clip(12);
    const clips = [a, b, c];
    const layouts = layoutClips(clips);
    const segs = planSegments(clips, 10, { grid });
    for (const seg of segs.slice(1)) {
      for (const l of layouts) {
        if (l.transitionIn > 0) expect(seg.start > l.start - 1e-6 && seg.start < l.start + l.transitionIn + 1e-6).toBe(false);
      }
      const units = seg.start / grid;
      expect(Math.abs(units - Math.round(units))).toBeLessThan(1e-6);
    }
  });

  it("is a no-op without a grid", () => {
    expect(planSegments([clip(10), clip(10), clip(10)], 10).map((s) => s.start)).toEqual([0, 10, 20]);
  });
});
