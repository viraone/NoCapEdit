import { describe, expect, it } from "vitest";
import { createClip, createProject } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { applyRemovals, findFillerWords, findSilences, keepOnly, makeTimeMap, mergeRanges, subtractRanges } from "@/lib/edit/magicCut";
import { layoutClips } from "@/lib/models/timeline";
import { findHighlights, sentencesFromCues } from "@/lib/edit/highlights";

const w = (text: string, start: number, end: number) => ({ text, start, end });

describe("magic cut detection", () => {
  it("finds filler words with padding inside the cue", () => {
    const cues = [{ id: "1", start: 0, end: 2, text: "so um this is uh great", words: [w("so", 0, 0.2), w("um", 0.3, 0.5), w("this", 0.6, 0.8), w("is", 0.9, 1), w("uh", 1.1, 1.3), w("great", 1.4, 1.8)] }];
    const r = findFillerWords(cues);
    expect(r.map((x) => x.label)).toEqual(["um", "uh"]);
    expect(r[0].start).toBeCloseTo(0.27);
    expect(r[0].end).toBeCloseTo(0.53);
  });
  it("finds dead air from peaks with margins", () => {
    const clip = createClip({ assetId: "a", name: "c", duration: 10, width: 1, height: 1, hasAudio: true });
    const perSecond = 10;
    const peaks = new Uint8Array(100).fill(200);
    for (let i = 30; i < 50; i++) peaks[i] = 5; // silence 3s–5s
    const [layout] = layoutClips([clip]);
    const r = findSilences({ peaks, perSecond }, layout);
    expect(r).toHaveLength(1);
    expect(r[0].start).toBeCloseTo(3.15);
    expect(r[0].end).toBeCloseTo(4.85);
  });
  it("merges and subtracts ranges", () => {
    const merged = mergeRanges([{ start: 1, end: 2, kind: "filler" }, { start: 1.5, end: 3, kind: "silence" }, { start: 5, end: 6, kind: "filler" }]);
    expect(merged.map((r) => [r.start, r.end])).toEqual([[1, 3], [5, 6]]);
    expect(subtractRanges(0, 10, merged)).toEqual([[0, 1], [3, 5], [6, 10]]);
    const map = makeTimeMap(merged);
    expect(map(0.5)).toBe(0.5);
    expect(map(4)).toBe(2);
    expect(map(8)).toBe(5);
  });
});

describe("applyRemovals", () => {
  it("splits clips, drops removed cues and re-times the rest", () => {
    const project = createProject();
    project.clips = [createClip({ assetId: "a", name: "c", duration: 10, width: 1, height: 1, hasAudio: true })];
    project.cues = [
      { id: "1", start: 0.5, end: 1.5, text: "hello there", words: [w("hello", 0.5, 0.9), w("there", 1, 1.4)] },
      { id: "2", start: 2, end: 3, text: "um", words: [w("um", 2, 2.4)] },
      { id: "3", start: 6, end: 7, text: "later words", words: [w("later", 6, 6.4), w("words", 6.5, 6.9)] },
    ];
    project.overlays = [{ id: "o", kind: "text", variant: "title", text: "t", start: 5, end: 8, x: 0.5, y: 0.5, fontSize: 0.05, fontFamily: "inter", color: "#fff", background: null, bold: true, italic: false, align: "center", opacity: 1, rotation: 0, maxWidth: 1 }];
    const stats = applyRemovals(project, [{ start: 2, end: 3, kind: "filler" }, { start: 4, end: 5, kind: "silence" }]);
    expect(stats.removedSeconds).toBe(2);
    expect(project.clips).toHaveLength(3);
    expect(project.clips.map((c) => [c.inPoint, c.outPoint])).toEqual([[0, 2], [3, 4], [5, 10]]);
    expect(projectDuration(project.clips)).toBe(8);
    expect(project.cues.map((c) => c.id)).toEqual(["1", "3"]);
    expect(project.cues[1].start).toBe(4);
    expect(project.cues[1].words?.[0].start).toBe(4);
    expect(project.overlays[0].start).toBe(3);
    expect(project.overlays[0].end).toBe(6);
  });
  it("keepOnly trims to a window", () => {
    const project = createProject();
    project.clips = [createClip({ assetId: "a", name: "c", duration: 60, width: 1, height: 1, hasAudio: true })];
    keepOnly(project, 10, 40);
    expect(projectDuration(project.clips)).toBe(30);
    expect(project.clips[0].inPoint).toBe(10);
  });
});

describe("highlights", () => {
  const cues = [
    { id: "1", start: 0, end: 3, text: "Welcome back to the channel." },
    { id: "2", start: 3, end: 8, text: "Today I'll show you the one mistake that costs creators 40% of their views." },
    { id: "3", start: 8, end: 12, text: "It's simple." },
    { id: "4", start: 12, end: 20, text: "Nobody talks about retention curves, but they decide everything." },
    { id: "5", start: 20, end: 25, text: "Anyway, thanks for watching." },
  ];
  it("splits sentences on punctuation", () => {
    expect(sentencesFromCues(cues)).toHaveLength(5);
  });
  it("ranks the hooky window first", () => {
    const h = findHighlights(cues, 15, 2);
    expect(h.length).toBeGreaterThan(0);
    expect(h[0].start).toBe(3);
    expect(h[0].reasons).toContain("has a concrete number");
  });
});
