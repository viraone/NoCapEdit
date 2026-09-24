import { describe, expect, it } from "vitest";
import { parseSrt, toSrt, toTranscript } from "@/lib/captions/srt";
import { formatSrtTime, parseSrtTime } from "@/lib/utils/time";

describe("srt", () => {
  it("formats SubRip timestamps", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(3661.5)).toBe("01:01:01,500");
    expect(parseSrtTime("01:01:01,500")).toBe(3661.5);
    expect(parseSrtTime("00:05.25")).toBe(5.25);
  });
  it("round-trips cues", () => {
    const cues = [
      { id: "1", start: 0, end: 1.2, text: "Hello there", translatedText: "Hola" },
      { id: "2", start: 1.5, end: 3, text: "Second line" },
    ];
    const srt = toSrt(cues);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:01,200\nHello there");
    const parsed = parseSrt(srt);
    expect(parsed).toHaveLength(2);
    expect(parsed[1].text).toBe("Second line");
    expect(parsed[1].start).toBe(1.5);
    expect(toSrt(cues, true)).toContain("Hola");
  });
  it("builds paragraphs on long pauses", () => {
    const txt = toTranscript([
      { id: "1", start: 0, end: 1, text: "One" },
      { id: "2", start: 1.2, end: 2, text: "two." },
      { id: "3", start: 5, end: 6, text: "Three." },
    ]);
    expect(txt).toBe("One two.\n\nThree.\n");
  });
});
