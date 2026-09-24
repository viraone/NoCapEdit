import { describe, expect, it } from "vitest";
import { buildSpeakerCues, speakerAt, toWebVtt, assignSpeakers } from "@/lib/transcriptionEngine";

const w = (text: string, start: number, end: number) => ({ text, start, end });
const segments = [
  { start: 0, end: 2, speaker: 0 },
  { start: 2, end: 4, speaker: 1 },
];

describe("speakerAt", () => {
  it("picks the speaker with the largest overlap", () => {
    expect(speakerAt(segments, 0.5, 1)).toBe(0);
    expect(speakerAt(segments, 1.8, 2.5)).toBe(1);
    expect(speakerAt(segments, 4.2, 4.4)).toBe(1);
    expect(speakerAt(segments, 9, 10)).toBeUndefined();
  });
});

describe("buildSpeakerCues", () => {
  it("never mixes speakers inside a cue", () => {
    const words = [w("hi", 0, 0.3), w("there", 0.4, 0.7), w("hello", 2.1, 2.4), w("back", 2.5, 2.8)];
    const cues = buildSpeakerCues(words, segments);
    expect(cues.map((c) => [c.text, c.speaker])).toEqual([
      ["hi there", 0],
      ["hello back", 1],
    ]);
  });
  it("falls back to plain grouping without segments", () => {
    const cues = buildSpeakerCues([w("a", 0, 0.2), w("b", 0.3, 0.5)], null);
    expect(cues).toHaveLength(1);
    expect(cues[0].speaker).toBeUndefined();
  });
});

describe("toWebVtt", () => {
  it("writes karaoke timestamps and speaker voices", () => {
    const cues = assignSpeakers(buildSpeakerCues([w("hi", 0, 0.3), w("there", 0.4, 0.7)], segments), segments);
    const vtt = toWebVtt(cues, { karaoke: true, speakers: true });
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:00.000 --> 00:00:00.950");
    expect(vtt).toContain("<v Speaker 1>hi <00:00:00.400>there");
  });
});
