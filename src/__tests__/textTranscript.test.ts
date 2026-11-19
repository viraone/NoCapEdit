import { describe, expect, it } from "vitest";
import { textToTranscript } from "@/lib/documentary/transcript";

describe("textToTranscript", () => {
  it("splits two paragraphs separated by a blank line into two cues", () => {
    const t = textToTranscript("Lesson", "First para.\n\nSecond para.");
    expect(t.title).toBe("Lesson");
    expect(t.id).toBe("pasted");
    expect(t.language).toBe("en");
    expect(t.cues).toEqual([
      { start: 0, end: 5, text: "First para." },
      { start: 5, end: 10, text: "Second para." },
    ]);
  });

  it("makes each line a cue when there is no blank line", () => {
    expect(textToTranscript("T", "a\nb\nc").cues.map((c) => c.text)).toEqual(["a", "b", "c"]);
  });

  it("keeps one block with no newline as one cue", () => {
    expect(textToTranscript("T", "just one block of words").cues).toHaveLength(1);
  });

  it("collapses whitespace and handles Windows line endings", () => {
    expect(textToTranscript("T", "one   two\r\n\r\nthree\tfour").cues.map((c) => c.text)).toEqual([
      "one two",
      "three four",
    ]);
  });

  it("uses 'Pasted text' for a blank title", () => {
    expect(textToTranscript("   ", "x").title).toBe("Pasted text");
  });

  it("gives no cues for empty or blank text", () => {
    expect(textToTranscript("T", "  \n ").cues).toHaveLength(0);
  });
});
