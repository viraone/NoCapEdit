import { describe, expect, it } from "vitest";
import { rippleCues, rippleTimeline } from "@/lib/models/ripple";
import { applyReelReveal } from "@/lib/edit/reelStretch";
import { cuesForRange } from "@/lib/edit/reelMaker";
import type { CaptionCue, Clip, VideoProject } from "@/lib/models/project";

const cue = (id: string, words: [string, number, number][]): CaptionCue =>
  ({ id, start: words[0][1], end: words[words.length - 1][2], text: words.map((w) => w[0]).join(" "), words: words.map(([text, start, end]) => ({ text, start, end })) }) as CaptionCue;

// The source's captions, seconds from where the reel starts; the reel's media begins 10 s earlier.
const R = 1000;
const spoken = [
  cue("a", [["that.", 20.77, 21.17], ["But", 21.37, 22.53], ["then", 22.53, 23.11]]),
  cue("b", [["she", 23.11, 24.07], ["was", 24.07, 24.29], ["mad", 24.29, 24.41], ["at", 24.41, 24.47]]),
  cue("c", [["me,", 24.47, 24.52], ["and", 24.59, 24.65], ["then", 24.65, 24.75], ["I", 24.75, 25.07]]),
  cue("d", [["doubled", 25.07, 25.49], ["down,", 25.49, 25.65], ["though.", 25.73, 25.79], ["And", 25.87, 25.95]]),
];
const source = spoken.map((c) => ({ ...c, start: c.start + R, end: c.end + R, words: c.words!.map((w) => ({ ...w, start: w.start + R, end: w.end + R })) }));
const mediaStart = R - 10;

const clip = (inPoint: number, outPoint: number) => ({ id: "k", assetId: "x", inPoint, outPoint, speed: 1, duration: 60, transition: { type: "none", duration: 0 } }) as unknown as Clip;
const reel = (inPoint: number, outPoint: number, cues: CaptionCue[]) =>
  ({ clips: [clip(inPoint, outPoint)], cues, overlays: [], voiceovers: [], music: null, reel: { index: 1, title: "t", score: 1, start: R, end: R + outPoint - inPoint, media: { start: mediaStart, end: mediaStart + 60 } } }) as unknown as VideoProject;

/** What releasing a dragged clip edge does on a reel: the ripple, then the source fills what was revealed. */
function dragEnd(p: VideoProject, outPoint: number): VideoProject {
  const next = structuredClone(p);
  const { inPoint, outPoint: from } = p.clips[0];
  next.clips[0].outPoint = outPoint;
  rippleTimeline(p, next);
  applyReelReveal(next, { shown: { start: mediaStart + inPoint, end: mediaStart + from }, range: { start: mediaStart + inPoint, end: mediaStart + outPoint }, sourceCues: source });
  return next;
}

const overlaps = (cues: CaptionCue[]) => [...cues].sort((a, b) => a.start - b.start).filter((c, i, all) => i > 0 && c.start < all[i - 1].end - 1e-3);

describe("dragging a reel's end out over a caption it cut in two", () => {
  // A cut at the front sends each caption through the ripple's rounding; this clip end makes the last one round up, past the clip.
  const shortened = (out: number) => {
    const before = reel(10, out, cuesForRange(source, R, R + (out - 10)));
    const after = structuredClone(before);
    after.clips[0].inPoint = 10.03;
    rippleTimeline(before, after);
    return after;
  };

  it("takes the caption back to its own end, not to the clip's new end", () => {
    const p = shortened(34.09996);
    expect(p.cues[p.cues.length - 1].end).toBeGreaterThan(p.clips[0].outPoint - p.clips[0].inPoint);
    const out = dragEnd(p, 10.03 + 28.45);
    const she = out.cues.filter((c) => c.text === "she was mad at");
    expect(she).toHaveLength(1);
    expect(she[0].end).toBeCloseTo(24.44);
    expect(she[0].words!.map((w) => w.text)).toEqual(["she", "was", "mad", "at"]);
    expect(overlaps(out.cues)).toEqual([]);
  });

  it("gives back the words a trim took, instead of saying them twice", () => {
    const whole = reel(10, 58, cuesForRange(source, R, R + 48));
    const out = dragEnd(dragEnd(whole, 34.1), 38.45);
    const texts = out.cues.map((c) => c.text);
    expect(texts.filter((t) => t.includes("she"))).toEqual(["she was mad at"]);
    expect(out.cues.find((c) => c.text === "she was mad at")!.end).toBeCloseTo(24.47);
    expect(overlaps(out.cues)).toEqual([]);
  });
});

describe("rippleCues at the video's end", () => {
  const longer = [clip(0, 28)];
  const shorter = [clip(0, 20)];

  it("leaves a caption alone when rounding put its end a hair past the end of the video", () => {
    const [c] = rippleCues(shorter, longer, [{ id: "x", start: 18, end: 20.00005, text: "hi" } as CaptionCue]);
    expect(c.end).toBeCloseTo(20);
  });

  it("still keeps a caption's distance when it really runs past the end", () => {
    const [c] = rippleCues(shorter, longer, [{ id: "x", start: 18, end: 21, text: "hi" } as CaptionCue]);
    expect(c.end).toBeCloseTo(29);
  });
});
