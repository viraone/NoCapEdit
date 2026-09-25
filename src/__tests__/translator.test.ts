import { describe, expect, it } from "vitest";
import { translateTexts } from "@/lib/speech/translator";

describe("translateTexts with source === target", () => {
  it("copies the text without claiming an engine ran", async () => {
    const result = await translateTexts(["hello", "world"], { source: "en", target: "en" });
    expect(result).toEqual({ translations: ["hello", "world"], engine: "copy" });
  });
  it("copies an empty list too", async () => {
    const result = await translateTexts([], { source: "fr", target: "fr" });
    expect(result).toEqual({ translations: [], engine: "copy" });
  });
});
