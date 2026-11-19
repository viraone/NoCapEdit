import { describe, expect, it } from "vitest";
import { MAX_CHAT_TRANSCRIPT_CHARS, trimTranscript } from "@/lib/documentary/chat";
import { filmTimeAt } from "@/lib/documentary/editorChat";
import type { DocScript } from "@/lib/documentary/script";
import { buildTimeline } from "@/lib/documentary/timeline";
import { createClip, type ProjectDocumentary } from "@/lib/models/project";

const script: DocScript = {
  title: "Passing the Exam",
  scenes: [
    { id: "s1", kind: "title", heading: "Passing the Exam", lines: ["A guide"], narration: "Welcome to the film." },
    { id: "s2", kind: "point", heading: "Two exams", lines: ["Core 1", "Core 2"], narration: "There are two exams to pass." },
    { id: "s3", kind: "credits", heading: "", lines: [], narration: "Thanks." },
  ],
};
const doc: ProjectDocumentary = { assetId: "film", script, timeline: buildTimeline(script.scenes, [5, 10, 2]), transcript: "words" };
const film = () => createClip({ assetId: "film", name: "Film", duration: 22.8, width: 1280, height: 720, hasAudio: true });
const intro = () => createClip({ assetId: "intro", name: "Intro", duration: 10, width: 1280, height: 720, hasAudio: true });

describe("filmTimeAt", () => {
  it("untouched film clip", () => {
    expect(filmTimeAt(doc, [film()], 12)).toBeCloseTo(12, 5);
  });
  it("trimmed start", () => {
    const c = film();
    c.inPoint = 5;
    expect(filmTimeAt(doc, [c], 3)).toBeCloseTo(8, 5);
  });
  it("double speed", () => {
    const c = film();
    c.speed = 2;
    expect(filmTimeAt(doc, [c], 4)).toBeCloseTo(8, 5);
  });
  it("a clip before the film", () => {
    expect(filmTimeAt(doc, [intro(), film()], 13)).toBeCloseTo(3, 5);
  });
  it("playhead over a clip that is not the film", () => {
    expect(filmTimeAt(doc, [intro(), film()], 4)).toBeCloseTo(0, 5);
  });
  it("no clips", () => {
    expect(filmTimeAt(doc, [], 7)).toBeCloseTo(0, 5);
  });
  it("past the end", () => {
    expect(filmTimeAt(doc, [film()], 999)).toBeCloseTo(22.8, 5);
  });
  it("negative time", () => {
    expect(filmTimeAt(doc, [film()], -3)).toBeCloseTo(0, 5);
  });
});

describe("trimTranscript", () => {
  it("a short text comes back unchanged", () => {
    expect(trimTranscript("hello")).toBe("hello");
  });
  it("a long text keeps its start and end", () => {
    const long = "a".repeat(MAX_CHAT_TRANSCRIPT_CHARS) + "b".repeat(MAX_CHAT_TRANSCRIPT_CHARS);
    const out = trimTranscript(long);
    expect(out).toContain("[... middle left out ...]");
    expect(out.startsWith("a")).toBe(true);
    expect(out.endsWith("b")).toBe(true);
    expect(out.length).toBeLessThan(MAX_CHAT_TRANSCRIPT_CHARS + 40);
  });
  it("a custom limit", () => {
    expect(trimTranscript("x".repeat(100), 100)).toHaveLength(100);
    expect(trimTranscript("x".repeat(101), 100)).toContain("[... middle left out ...]");
  });
});
