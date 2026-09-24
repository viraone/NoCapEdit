import { describe, expect, it } from "vitest";
import { createClip } from "@/lib/models/project";
import { layoutClips, projectDuration } from "@/lib/models/timeline";
import { planSegments } from "@/lib/ffmpeg/segments";

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
