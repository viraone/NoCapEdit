import { describe, expect, it } from "vitest";
import { applyReelReveal, applyReelStretch, mergeStretchedCues, recaptionFromSource, reelMedia, reelSlack, reelSourceRange, stretchOf } from "@/lib/edit/reelStretch";
import { createClip, createProject, type CaptionCue, type ReelInfo, type VideoProject } from "@/lib/models/project";
import { rippleTimeline } from "@/lib/models/ripple";
import { reelOnSource } from "@/lib/models/timeline";

const clip = (duration: number, extra: Partial<ReturnType<typeof createClip>> = {}) => ({
  ...createClip({ assetId: "src", name: "c", duration, width: 1920, height: 1080, hasAudio: true }),
  ...extra,
});
const cue = (id: string, start: number, end: number, text = id, words?: [number, number][]): CaptionCue =>
  ({ id, text, start, end, words: words?.map(([s, e]) => ({ text: "w", start: s, end: e })) }) as CaptionCue;

const info: ReelInfo = { index: 1, title: "t", score: 9, start: 90, end: 130 };
const source = () => createProject({ id: "src_prj", name: "Show", clips: [clip(300)] });
/** A reel cut before slack existed: its 40 s media is exactly the pick. */
const legacyReel = () => {
  const p = createProject({ id: "reel_prj", name: "Show · Reel 1 · t", sourceProjectId: "src_prj", reel: { ...info } });
  p.clips = [clip(40, { assetId: "reel_media", audioAssetId: "clean", audioLabel: "Voice", reframe: { keyframes: [{ t: 1, x: 0.1, y: 0 }] }, matte: { assetId: "m", width: 1, height: 1, fps: 4, count: 160, inPoint: 0, outPoint: 40 } })];
  p.cues = [cue("a", 0, 2), cue("b", 10, 12, "b", [[10, 11], [11, 12]])];
  p.overlays = [{ id: "o", kind: "text", variant: "title", text: "hi", start: 5, end: 8, x: 0.5, y: 0.2, fontSize: 0.05, fontFamily: "inter", color: "#fff", background: null, bold: true, italic: false, align: "center", opacity: 1, rotation: 0, maxWidth: 0.8, track: { keyframes: [{ t: 6, x: 0.5, y: 0.5 }], offset: { x: 0, y: 0 } } }];
  p.voiceovers = [{ id: "v", assetId: "va", name: "vo", text: "x", start: 3, duration: 2, volume: 1 }];
  return p;
};

describe("reel media and slack", () => {
  it("falls back to the pick for reels cut without slack", () => {
    expect(reelMedia({ reel: info })).toEqual({ start: 90, end: 130 });
    expect(reelMedia({ reel: { ...info, media: { start: 80, end: 140 } } })).toEqual({ start: 80, end: 140 });
    expect(reelMedia({ reel: null })).toBeNull();
  });

  it("finds the span of the source clip the reel came from", () => {
    expect(reelSourceRange(source(), { reel: info })).toEqual({ start: 0, end: 300 });
    const two = createProject({ clips: [clip(100), clip(200)] });
    expect(reelSourceRange(two, { reel: { ...info, start: 150 } })).toEqual({ start: 100, end: 300 });
    expect(reelSourceRange(two, { reel: { ...info, start: 400 } })).toBeNull();
    expect(reelSourceRange({ clips: [] }, { reel: info })).toBeNull();
  });

  it("measures how far the media can grow on each side", () => {
    expect(reelSlack(legacyReel(), source())).toEqual({ before: 90, after: 170 });
    const withSlack = legacyReel();
    withSlack.reel = { ...info, media: { start: 80, end: 140 } };
    expect(reelSlack(withSlack, source())).toEqual({ before: 80, after: 160 });
  });

  it("refuses when this isn't a one-clip reel of that source", () => {
    expect(reelSlack(legacyReel(), null)).toBeNull();
    expect(reelSlack(legacyReel(), createProject({ id: "other" }))).toBeNull();
    const split = legacyReel();
    split.clips.push(clip(5));
    expect(reelSlack(split, source())).toBeNull();
    expect(reelSlack(createProject({ clips: [clip(10)] }), source())).toBeNull();
  });

  it("reads a drag past the media off the clip's in and out points", () => {
    expect(stretchOf({ inPoint: 0, outPoint: 40, duration: 40 })).toEqual({ before: 0, after: 0 });
    expect(stretchOf({ inPoint: -3, outPoint: 41.5, duration: 40 })).toEqual({ before: 3, after: 1.5 });
  });
});

describe("mergeStretchedCues", () => {
  const range = { start: 85, end: 133 };
  const shown = { start: 90, end: 130 };
  /** Reel cues already moved to the new timeline (5 s later). */
  const existing = () => [cue("a", 5, 7), cue("b", 15, 17)];

  it("adds the source captions for the new head and tail at their new times", () => {
    const src = [cue("x", 83, 86), cue("z", 131.5, 135, "z", [[131.5, 133], [133, 135]])];
    const { cues, added } = mergeStretchedCues(existing(), src, range, shown);
    expect(added).toBe(2);
    expect(cues.map((c) => [c.text, c.start, c.end])).toEqual([
      ["x", 0, 1],
      ["a", 5, 7],
      ["b", 15, 17],
      ["z", 46.5, 48],
    ]);
    expect(cues[3].words?.map((w) => [w.start, w.end])).toEqual([[46.5, 48]]);
    expect(cues.every((c) => !["x", "z"].includes(c.id))).toBe(true);
  });

  it("grows a caption that was cut short at an old edge instead of adding it twice", () => {
    const src = [cue("a2", 89, 92, "a", [[89, 90.5], [90.5, 92]]), cue("t", 129, 131)];
    const { cues, added } = mergeStretchedCues(existing(), src, range, shown);
    expect(added).toBe(1);
    const a = cues.find((c) => c.id === "a")!;
    expect([a.start, a.end]).toEqual([4, 7]);
    expect(a.words?.map((w) => [w.start, w.end])).toEqual([
      [4, 5.5],
      [5.5, 7],
    ]);
    expect(cues.filter((c) => c.text === "a")).toHaveLength(1);
    // "t" straddles the old end but no reel cue carries it: the new part is added on its own.
    expect(cues.find((c) => c.text === "t")).toMatchObject({ start: 45, end: 46 });
  });

  it("leaves the cues alone when nothing new was shown", () => {
    const { cues, added } = mergeStretchedCues(existing(), [cue("x", 83, 86)], shown, shown);
    expect(added).toBe(0);
    expect(cues).toEqual(existing());
  });
});

describe("applyReelReveal", () => {
  const src = [cue("s1", 1, 3, "one"), cue("s2", 3, 5, "two"), cue("s3", 5, 7, "three"), cue("s4", 7, 8.5, "four")];
  /** A reel with slack: media covers source 0..8.19, the clip shows 2..6. */
  const reel = () => {
    const p = createProject({ id: "reel_prj", sourceProjectId: "src_prj", reel: { ...info, start: 2, end: 6, media: { start: 0, end: 8.19 } } });
    p.clips = [clip(8.19, { assetId: "m", inPoint: 2, outPoint: 6 })];
    p.cues = [cue("r1", 0, 1, "one"), cue("r2", 1, 3, "two"), cue("r3", 3, 4, "three")];
    return p;
  };
  const times = (p: VideoProject) => p.cues.map((c) => [c.text, c.start, c.end]);

  it("brings in the source captions when the end is dragged out inside the slack", () => {
    const p = reel();
    p.clips[0].outPoint = 8;
    const stats = applyReelReveal(p, { shown: { start: 2, end: 6 }, range: { start: 2, end: 8 }, sourceCues: src });
    expect(stats).toEqual({ before: 0, after: 2, addedCues: 1 });
    expect(times(p)).toEqual([
      ["one", 0, 1],
      ["two", 1, 3],
      ["three", 3, 5],
      ["four", 5, 6],
    ]);
    expect(p.reel).toMatchObject({ start: 2, end: 8, media: { start: 0, end: 8.19 } });
  });

  /** A timeline drag: the ripple moves the captions with the picture, then the reveal fills the new part. */
  const drag = (edit: (p: VideoProject) => void) => {
    const base = reel();
    const p = structuredClone(base);
    edit(p);
    rippleTimeline(base, p);
    return p;
  };

  it("moves the captions with the picture when the start is dragged out", () => {
    const p = drag((p) => void (p.clips[0].inPoint = 1));
    const stats = applyReelReveal(p, { shown: { start: 2, end: 6 }, range: { start: 1, end: 6 }, sourceCues: src });
    expect(stats).toEqual({ before: 1, after: 0, addedCues: 0 });
    expect(times(p)).toEqual([
      ["one", 0, 2],
      ["two", 2, 4],
      ["three", 4, 5],
    ]);
    expect(p.reel).toMatchObject({ start: 1, end: 6 });
  });

  it("keeps captions on the picture when the start is trimmed in, dropping what fell off", () => {
    const p = drag((p) => void (p.clips[0].inPoint = 3.5));
    applyReelReveal(p, { shown: { start: 2, end: 6 }, range: { start: 3.5, end: 6 }, sourceCues: src });
    expect(times(p)).toEqual([
      ["two", 0, 1.5],
      ["three", 1.5, 2.5],
    ]);
    expect(p.reel).toMatchObject({ start: 3.5, end: 6 });
  });

  it("refuses a project that isn't a one-clip reel", () => {
    expect(applyReelReveal(createProject({ clips: [clip(10)] }), { shown: { start: 0, end: 1 }, range: { start: 0, end: 2 }, sourceCues: [] })).toBeNull();
  });
});

describe("applyReelStretch", () => {
  const fresh = () => clip(68, { assetId: "fresh", name: "Show · Reel 1 · t", hasAudio: true });
  const stretch = (p: VideoProject) =>
    applyReelStretch(p, {
      fresh: fresh(),
      media: { start: 75, end: 143 },
      range: { start: 85, end: 133 },
      sourceCues: [cue("x", 83, 86), cue("a2", 89, 92, "a"), cue("z", 131.5, 135)],
    });

  it("puts the clip on the new media and moves everything with it", () => {
    const p = legacyReel();
    const stats = stretch(p)!;
    expect(stats).toEqual({ before: 5, after: 3, addedCues: 2, droppedCleanAudio: true });
    const c = p.clips[0];
    expect(c).toMatchObject({ assetId: "fresh", duration: 68, inPoint: 10, outPoint: 58, name: "c", audioAssetId: null, audioLabel: null });
    expect(c.reframe?.keyframes).toEqual([{ t: 16, x: 0.1, y: 0 }]);
    expect(c.matte).toMatchObject({ inPoint: 15, outPoint: 55 });
    expect(p.cues.map((q) => [q.text, q.start, q.end])).toEqual([
      ["x", 0, 1],
      ["a", 4, 7],
      ["b", 15, 17],
      ["z", 46.5, 48],
    ]);
    expect(p.cues.find((q) => q.text === "b")?.words?.map((w) => [w.start, w.end])).toEqual([
      [15, 16],
      [16, 17],
    ]);
    expect(p.overlays[0]).toMatchObject({ start: 10, end: 13 });
    expect(p.overlays[0].track?.keyframes[0].t).toBe(11);
    expect(p.voiceovers[0].start).toBe(8);
    expect(p.reel).toEqual({ ...info, start: 85, end: 133, media: { start: 75, end: 143 } });
  });

  it("keeps a reel that already had slack in step", () => {
    const p = legacyReel();
    p.reel = { ...info, media: { start: 80, end: 140 } };
    p.clips[0] = clip(60, { assetId: "reel_media", inPoint: 10, outPoint: 50 });
    const stats = applyReelStretch(p, { fresh: fresh(), media: { start: 75, end: 143 }, range: { start: 85, end: 133 }, sourceCues: [] })!;
    expect(stats).toMatchObject({ before: 5, after: 3, droppedCleanAudio: false });
    expect(p.clips[0]).toMatchObject({ inPoint: 10, outPoint: 58 });
    expect(p.cues.map((q) => [q.start, q.end])).toEqual([
      [5, 7],
      [15, 17],
    ]);
  });

  it("refuses a project that isn't a one-clip reel", () => {
    const split = legacyReel();
    split.clips.push(clip(5));
    expect(stretch(split)).toBeNull();
    expect(stretch(createProject({ clips: [clip(10)] }))).toBeNull();
  });
});

describe("recaptionFromSource", () => {
  it("copies the source's captions for what the reel shows, timed from the reel's start", () => {
    const src = source();
    src.cues = [cue("before", 85, 87), cue("in", 95, 97), cue("edge", 128, 133), cue("after", 140, 142)];
    const reel = legacyReel();
    reel.reel = { ...info, media: { start: 80, end: 140 } };
    reel.clips = [clip(60, { assetId: "reel_media", inPoint: 10, outPoint: 50 })];
    expect(recaptionFromSource(reel, src)).toBe(2);
    expect(reel.cues.map((c) => [c.text, c.start, c.end])).toEqual([
      ["in", 5, 7],
      ["edge", 38, 40],
    ]);
  });

  it("refuses a project that isn't a one-clip reel of that source", () => {
    const src = source();
    const reel = legacyReel();
    reel.clips = [reel.clips[0], clip(5)];
    expect(recaptionFromSource(reel, src)).toBeNull();
    expect(recaptionFromSource(createProject({ name: "plain" }), src)).toBeNull();
  });
});

describe("a reel whose source was trimmed after it was cut", () => {
  // Cut with 5 s off the source's start: source file second = timeline second + 5.
  const cutReel = (): VideoProject => {
    const p = createProject({ id: "reel_prj", name: "Show · Reel 1 · t", sourceProjectId: "src_prj", reel: { ...info, media: { start: 80, end: 140 }, sourceOffset: 5, sourceAssetId: "src" } });
    p.clips = [clip(60, { assetId: "reel_media", inPoint: 10, outPoint: 50 })];
    return p;
  };
  // Then 3 s more came off, with the captions rippled along: the moment at timeline 95 is at 92 now.
  const trimmed = () => {
    const src = createProject({ id: "src_prj", name: "Show", clips: [clip(300, { inPoint: 8 })] });
    src.cues = [cue("said at the reel's start", 87, 89), cue("before it", 80, 82), cue("just past the end", 128, 129)];
    return src;
  };

  it("moves the reel's ranges with the source's timeline", () => {
    const moved = reelOnSource(cutReel().reel!, trimmed().clips);
    expect(moved).toMatchObject({ start: 87, end: 127, media: { start: 77, end: 137 }, sourceOffset: 8 });
    // Asking again changes nothing, and the same file second comes out either way.
    expect(reelOnSource(moved, trimmed().clips)).toBe(moved);
    expect(moved.start + moved.sourceOffset!).toBe(info.start + 5);
  });

  it("copies the captions said in the reel's own picture", () => {
    const reel = cutReel();
    expect(recaptionFromSource(reel, trimmed())).toBe(1);
    expect(reel.cues.map((c) => [c.text, c.start, c.end])).toEqual([["said at the reel's start", 0, 2]]);
  });

  it("measures the slack on the source as it is now", () => {
    const reel = cutReel();
    const src = trimmed();
    reel.reel = reelOnSource(reel.reel!, src.clips);
    expect(reelSlack(reel, src)).toEqual({ before: 77, after: 292 - 137 });
  });

  it("follows the clip when the source was cut in two or reordered", () => {
    const a = clip(300, { outPoint: 50 });
    const b = clip(300, { id: "second", inPoint: 80 });
    expect(reelOnSource(cutReel().reel!, [a, b])).toMatchObject({ start: 65, end: 105, sourceOffset: 30 });
    expect(reelOnSource(cutReel().reel!, [b, a])).toMatchObject({ start: 15, end: 55, sourceOffset: 80 });
  });

  it("leaves reels with no origin, or whose part of the file is gone, as they are", () => {
    expect(reelOnSource(info, trimmed().clips)).toBe(info);
    const reel = cutReel();
    expect(reelOnSource(reel.reel!, [clip(300, { assetId: "other" })])).toBe(reel.reel);
    expect(reelSlack(reel, createProject({ id: "src_prj", name: "Show", clips: [clip(300, { assetId: "other" })] }))).toBeNull();
  });

  it("records where a stretch's new media came from", () => {
    const reel = legacyReel();
    applyReelStretch(reel, { fresh: clip(60, { assetId: "new" }), media: { start: 80, end: 140 }, range: { start: 90, end: 130 }, sourceCues: [], origin: { sourceOffset: 8, sourceAssetId: "src" } });
    expect(reel.reel).toMatchObject({ sourceOffset: 8, sourceAssetId: "src", media: { start: 80, end: 140 } });
  });
});
