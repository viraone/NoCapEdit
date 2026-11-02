import { describe, expect, it } from "vitest";
import { applyGeneratedCaptions, hasSpeechTrack, type GeneratedCaptions } from "@/lib/speech/generateCaptions";
import { createClip, createProject, type CaptionCue } from "@/lib/models/project";

const cue = (id: string, start: number, end: number, text = id): CaptionCue => ({ id, start, end, text });
const generated = (cues: CaptionCue[], extra: Partial<GeneratedCaptions> = {}): GeneratedCaptions => ({ cues, wordCount: cues.length * 2, device: "wasm", speakerCount: 0, hasSpeakers: false, diarizationNote: "", ...extra });

describe("applyGeneratedCaptions", () => {
  it("replaces the captions and records the language", () => {
    const p = createProject({ name: "t" });
    p.cues = [cue("old", 0, 1)];
    const kept = applyGeneratedCaptions(p, p.cues, generated([cue("n1", 0, 2), cue("n2", 2, 4)]), "en", false);
    expect(kept).toBe(0);
    expect(p.cues.map((c) => c.id)).toEqual(["n1", "n2"]);
    expect(p.captions.sourceLanguage).toBe("en");
    expect(p.subtitleStyle.speakerColors).toBe(false);
  });

  it("keeps captions added while the job ran, sorted in with the new ones", () => {
    const p = createProject({ name: "t" });
    const atStart: CaptionCue[] = [];
    p.cues = [cue("typed", 3, 4)];
    const kept = applyGeneratedCaptions(p, atStart, generated([cue("n1", 0, 2), cue("n2", 5, 6)]), "auto", false);
    expect(kept).toBe(1);
    expect(p.cues.map((c) => c.id)).toEqual(["n1", "typed", "n2"]);
  });

  it("turns on speaker colours only when speakers were found and asked for", () => {
    const p = createProject({ name: "t" });
    applyGeneratedCaptions(p, [], generated([cue("n1", 0, 2)], { hasSpeakers: true, speakerCount: 2 }), "en", true);
    expect(p.subtitleStyle.speakerColors).toBe(true);
    const q = createProject({ name: "t" });
    applyGeneratedCaptions(q, [], generated([cue("n1", 0, 2)], { hasSpeakers: true }), "en", false);
    expect(q.subtitleStyle.speakerColors).toBe(false);
  });

  it("moves the new captions with the picture when the start was trimmed while the job ran", () => {
    const p = createProject({ name: "t" });
    const clip = createClip({ assetId: "a", name: "c", duration: 100, width: 1, height: 1, hasAudio: true });
    const clipsAtStart = [clip];
    // The words were timed for the untrimmed clip; 5 s came off the start while the job ran.
    p.clips = [{ ...clip, inPoint: 5 }];
    applyGeneratedCaptions(p, [], generated([cue("n1", 10, 12), cue("gone", 1, 3)]), "en", false, clipsAtStart);
    expect(p.cues.map((c) => [c.id, c.start, c.end])).toEqual([["n1", 5, 7]]);
    // Nothing moved: the cues are taken as they are.
    const q = createProject({ name: "t" });
    q.clips = [clip];
    applyGeneratedCaptions(q, [], generated([cue("n1", 10, 12)]), "en", false, [clip]);
    expect(q.cues[0]).toMatchObject({ start: 10, end: 12 });
  });

  it("knows whether there is anything to transcribe", () => {
    const silent = { ...createClip({ assetId: "a", name: "c", duration: 5, width: 1, height: 1, hasAudio: false }) };
    expect(hasSpeechTrack([silent])).toBe(false);
    expect(hasSpeechTrack([silent, { ...silent, hasAudio: true }])).toBe(true);
    expect(hasSpeechTrack([])).toBe(false);
  });
});
