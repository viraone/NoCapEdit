import { describe, expect, it } from "vitest";
import { parseStoryChoices, STORY_DEFAULTS } from "@/lib/phone/storyChoices";

describe("parseStoryChoices", () => {
  it("returns defaults for null and is not the same object as STORY_DEFAULTS", () => {
    const result = parseStoryChoices(null);
    expect(result).toEqual(STORY_DEFAULTS);
    expect(result).not.toBe(STORY_DEFAULTS);
  });

  it("returns defaults for invalid JSON, null literal, and non-object JSON", () => {
    expect(parseStoryChoices("{bad")).toEqual(STORY_DEFAULTS);
    expect(parseStoryChoices("null")).toEqual(STORY_DEFAULTS);
    expect(parseStoryChoices("5")).toEqual(STORY_DEFAULTS);
  });

  it("parses valid choices correctly", () => {
    const json = '{"mute":true,"share":false,"audience":"close","linkUrl":"https://example.com","linkLabel":"SIGN UP NOW!","linkAt":"top","overlayAt":"bottom"}';
    expect(parseStoryChoices(json)).toEqual({
      mute: true,
      share: false,
      audience: "close",
      linkUrl: "https://example.com",
      linkLabel: "SIGN UP NOW!",
      linkAt: "top",
      overlayAt: "bottom",
    });
  });

  it("falls back to defaults for wrong types", () => {
    const json = '{"mute":"yes","share":1,"audience":"everyone","linkUrl":5,"linkLabel":null,"linkAt":"left","overlayAt":7}';
    expect(parseStoryChoices(json)).toEqual(STORY_DEFAULTS);
  });

  it("truncates linkUrl to 200 characters and linkLabel to 60 characters", () => {
    const longUrl = "a".repeat(300);
    const longLabel = "b".repeat(100);
    const json = JSON.stringify({ linkUrl: longUrl, linkLabel: longLabel });
    const result = parseStoryChoices(json);
    expect(result.linkUrl.length).toBe(200);
    expect(result.linkLabel.length).toBe(60);
  });
});
