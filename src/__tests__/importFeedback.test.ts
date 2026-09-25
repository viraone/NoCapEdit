import { describe, expect, it } from "vitest";
import { importErrorText } from "@/lib/media/importFeedback";

describe("importErrorText", () => {
  it("is null when every file imported", () => {
    expect(importErrorText([])).toBeNull();
  });
  it("lists one 'name: reason' line per failed file", () => {
    expect(importErrorText([{ name: "a.mp4", reason: "No video track found in this file." }, { name: "b.txt", reason: "This file could not be decoded by your browser." }])).toBe(
      "a.mp4: No video track found in this file.\nb.txt: This file could not be decoded by your browser.",
    );
  });
});
