import { describe, expect, it } from "vitest";
import { displayName, filterFormats } from "@/components/canvas/FormatPicker";
import { FRAME_FORMATS } from "@/lib/models/formats";

describe("format search", () => {
  it("lists everything for an empty query", () => {
    expect(filterFormats("  ")).toHaveLength(FRAME_FORMATS.length);
  });

  it("drops a ratio the name would repeat", () => {
    const name = (id: string) => displayName(FRAME_FORMATS.find((f) => f.id === id)!);
    expect(name("ig-reels")).toBe("Instagram Reels");
    expect(name("ig-portrait")).toBe("Instagram Post");
    expect(name("ig-square")).toBe("Instagram Post Square");
    expect(name("vertical")).toBe("Vertical");
    expect(name("classic")).toBe("Classic");
    expect(name("x-landscape")).toBe("X / Twitter 720p");
  });

  it("matches name, platform and ratio, every word, any case", () => {
    expect(filterFormats("story").map((f) => f.id)).toEqual(["ig-story"]);
    expect(filterFormats("YOUTUBE").map((f) => f.id)).toEqual(["yt-shorts", "yt-landscape"]);
    expect(filterFormats("instagram 1:1").map((f) => f.id)).toEqual(["ig-square"]);
    expect(filterFormats("16:9").every((f) => f.ratio === "16:9")).toBe(true);
    expect(filterFormats("nothing like this")).toEqual([]);
  });
});
