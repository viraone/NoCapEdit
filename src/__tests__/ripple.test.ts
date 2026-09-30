import { describe, expect, it } from "vitest";
import { createClip, createProject, type CaptionCue, type TextOverlay, type VideoProject } from "@/lib/models/project";
import { mapTime, rippleTimeline, sameSequence } from "@/lib/models/ripple";
import { layoutClips } from "@/lib/models/timeline";
import { cutAfter, cutBefore, duplicateClip, removeClip, reorderClip, splitClipAt } from "@/lib/models/clipOps";

const clip = (id: string, duration: number, extra: Partial<ReturnType<typeof createClip>> = {}) => ({
  ...createClip({ assetId: extra.assetId ?? "a", name: id, duration, width: 1920, height: 1080, hasAudio: true }),
  id,
  ...extra,
});
const cue = (id: string, start: number, end: number, words?: [string, number, number][]): CaptionCue =>
  ({ id, text: words ? words.map((w) => w[0]).join(" ") : id, start, end, ...(words ? { words: words.map(([text, s, e]) => ({ text, start: s, end: e })) } : {}) }) as CaptionCue;
const title = (start: number, end: number, keyframes: number[] = []): TextOverlay => ({
  id: "t", kind: "text", variant: "title", text: "hi", start, end, x: 0.5, y: 0.2, fontSize: 0.05, fontFamily: "inter", color: "#fff", background: null, bold: true, italic: false, align: "center", opacity: 1, rotation: 0, maxWidth: 0.8,
  ...(keyframes.length ? { track: { keyframes: keyframes.map((t) => ({ t, x: 0.5, y: 0.5 })), offset: { x: 0, y: 0 } } } : {}),
});

/** Clip A (0..10) then clip B (10..20) on another file; captions across both, one past the end. */
const project = (): VideoProject => {
  const p = createProject({ name: "t" });
  p.clips = [clip("A", 10), clip("B", 10, { assetId: "b" })];
  p.cues = [cue("c1", 1, 3), cue("c2", 4, 6, [["hello", 4, 5], ["world", 5, 6]]), cue("c3", 9, 11), cue("c4", 12, 14), cue("c5", 25, 27)];
  p.overlays = [title(2, 8, [2, 5])];
  p.voiceovers = [{ id: "v", assetId: "va", name: "vo", text: "x", start: 13, duration: 2, volume: 1 }];
  return p;
};
const after = (edit: (p: VideoProject) => void, base = project()) => {
  const next = structuredClone(base);
  edit(next);
  expect(rippleTimeline(base, next)).toBe(true);
  return next;
};
const times = (p: VideoProject) => p.cues.map((c) => [c.id, c.start, c.end]);

describe("rippleTimeline", () => {
  it("leaves everything alone when no clip moved", () => {
    const base = project();
    const next = structuredClone(base);
    next.clips[0].zoom = 2;
    expect(rippleTimeline(base, next)).toBe(false);
    expect(next.cues).toEqual(base.cues);
    expect(sameSequence(layoutClips(base.clips), layoutClips(next.clips))).toBe(true);
  });

  it("cut before: captions of the cut part go, the rest slide left, a caption on the cut is shortened to its kept words", () => {
    const p = after((p) => expect(cutBefore(p, 5)).toBe(true));
    expect(times(p)).toEqual([
      ["c2", 0, 1],
      ["c3", 4, 6],
      ["c4", 7, 9],
      ["c5", 20, 22],
    ]);
    const c2 = p.cues[0];
    expect(c2.words).toEqual([{ text: "world", start: 0, end: 1 }]);
    expect(c2.text).toBe("world");
    expect(p.voiceovers[0].start).toBe(8);
    // The title started on the cut part: it now begins at the new start and its keyframes came along.
    expect([p.overlays[0].start, p.overlays[0].end]).toEqual([0, 3]);
    expect(p.overlays[0].track?.keyframes.map((k) => k.t)).toEqual([0, 0]);
  });

  it("cut after: a caption across the cut is clipped to it, the next clip's captions slide up", () => {
    const p = after((p) => expect(cutAfter(p, 5)).toBe(true));
    expect(times(p)).toEqual([
      ["c1", 1, 3],
      ["c2", 4, 5],
      ["c3", 5, 6],
      ["c4", 7, 9],
      ["c5", 20, 22],
    ]);
  });

  it("removing a clip drops its captions and pulls the rest up; a caption across the join keeps to the surviving clip", () => {
    const p = after((p) => void removeClip(p, "A"));
    expect(times(p)).toEqual([
      ["c3", 0, 1],
      ["c4", 2, 4],
      ["c5", 15, 17],
    ]);
    expect(p.voiceovers[0].start).toBe(3);
    // A title entirely on the removed clip is kept where it was rather than deleted.
    expect([p.overlays[0].start, p.overlays[0].end]).toEqual([2, 8]);
  });

  it("reordering carries each caption with its clip; one across the old join keeps to the clip it starts on", () => {
    const p = after((p) => expect(reorderClip(p, "B", 0)).toBe(true));
    expect(times(p)).toEqual([
      ["c4", 2, 4],
      ["c1", 11, 13],
      ["c2", 14, 16],
      ["c3", 19, 20],
      ["c5", 25, 27],
    ]);
  });

  it("splitting moves nothing", () => {
    const base = project();
    const p = after((p) => expect(splitClipAt(p, 5)).not.toBeNull(), base);
    expect(times(p)).toEqual(times(base));
    expect(p.overlays).toEqual(base.overlays);
  });

  it("duplicating a clip keeps the captions with the original and slides the later ones", () => {
    const p = after((p) => expect(duplicateClip(p, "A")).not.toBeNull());
    expect(times(p)).toEqual([
      ["c1", 1, 3],
      ["c2", 4, 6],
      ["c3", 9, 10],
      ["c4", 22, 24],
      ["c5", 35, 37],
    ]);
  });

  it("a speed change rescales the captions inside the clip, words included", () => {
    const p = after((p) => void (p.clips[0].speed = 2));
    expect(times(p)).toEqual([
      ["c1", 0.5, 1.5],
      ["c2", 2, 3],
      ["c3", 4.5, 6],
      ["c4", 7, 9],
      ["c5", 20, 22],
    ]);
    expect(p.cues[1].words?.map((w) => [w.start, w.end])).toEqual([
      [2, 2.5],
      [2.5, 3],
    ]);
  });

  it("a transition overlap slides the next clip's captions in", () => {
    const p = after((p) => void (p.clips[0].transition = { type: "fade", duration: 1 }));
    expect(times(p).find(([id]) => id === "c4")).toEqual(["c4", 11, 13]);
  });

  it("dragging a reel's edge past its media (negative in point) moves the captions right", () => {
    const base = createProject({ name: "r" });
    base.clips = [clip("R", 40, { inPoint: 2, outPoint: 30 })];
    base.cues = [cue("c", 0, 2)];
    const next = structuredClone(base);
    next.clips[0].inPoint = -1;
    expect(rippleTimeline(base, next)).toBe(true);
    expect(times(next)).toEqual([["c", 3, 5]]);
  });

  it("maps a span end that sits on a clip boundary to the clip before it", () => {
    const base = project();
    const next = structuredClone(base);
    reorderClip(next, "B", 0);
    const from = layoutClips(base.clips);
    const to = layoutClips(next.clips);
    expect(mapTime(from, to, 10, "end")?.time).toBe(20);
    expect(mapTime(from, to, 10, "start")?.time).toBe(0);
  });
});
