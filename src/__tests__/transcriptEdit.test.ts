import { describe, expect, it } from "vitest";
import { createClip, createProject } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { applyRemovals } from "@/lib/edit/magicCut";
import { activeWordIndex, flattenTranscript, groupParagraphs, rangeForWords } from "@/lib/edit/transcriptEdit";

const w = (text: string, start: number, end: number) => ({ text, start, end });
const cues = [
  { id: "a", start: 0, end: 2, text: "so I went", words: [w("so", 0, 0.3), w("I", 0.5, 0.7), w("went", 1, 1.4)] },
  { id: "b", start: 1.6, end: 3, text: "no wait Savannah", words: [w("no", 1.6, 1.8), w("wait", 2, 2.3), w("Savannah", 2.4, 3)] },
  { id: "c", start: 8, end: 9, text: "later", words: [w("later", 8, 8.5)], speaker: 1 },
  { id: "d", start: 20, end: 21, text: "an SRT line" },
];

describe("transcriptEdit", () => {
  it("flattens cues in order, one item for a cue without word timings", () => {
    const words = flattenTranscript(cues);
    expect(words.map((x) => x.text)).toEqual(["so", "I", "went", "no", "wait", "Savannah", "later", "an SRT line"]);
    expect(words[7]).toMatchObject({ start: 20, end: 21, cueId: "d" });
  });

  it("starts a paragraph on a new speaker or after a long pause", () => {
    const p = groupParagraphs(flattenTranscript(cues));
    expect(p.map((x) => [x.from, x.to])).toEqual([[0, 6], [6, 7], [7, 8]]);
  });

  it("finds the word being spoken", () => {
    const words = flattenTranscript(cues);
    expect(activeWordIndex(words, -1)).toBe(-1);
    expect(activeWordIndex(words, 0.1)).toBe(0);
    expect(activeWordIndex(words, 0.9)).toBe(1);
    expect(activeWordIndex(words, 2.45)).toBe(5);
  });

  it("cuts from the first word to the last, reaching only a little into the pauses", () => {
    const words = flattenTranscript(cues);
    const r = rangeForWords(words, 4, 3)!;
    expect(r.start).toBeCloseTo(1.56, 5);
    expect(r.end).toBeCloseTo(2.34, 5);
    expect(r.label).toBe("no wait");
    const edge = rangeForWords(words, 0, 0)!;
    expect(edge.start).toBe(0);
    expect(edge.end).toBeCloseTo(0.34, 5);
  });

  it("removing words closes the gap and drops them from the captions", () => {
    const project = createProject();
    project.clips = [createClip({ assetId: "x", name: "c", duration: 10, width: 1, height: 1, hasAudio: true })];
    project.cues = structuredClone(cues);
    const words = flattenTranscript(project.cues);
    applyRemovals(project, [rangeForWords(words, 3, 4)!]);
    expect(projectDuration(project.clips)).toBeLessThan(10);
    expect(project.cues.find((c) => c.id === "b")!.text).toBe("Savannah");
    expect(flattenTranscript(project.cues).map((x) => x.text).slice(0, 4)).toEqual(["so", "I", "went", "Savannah"]);
  });
});
