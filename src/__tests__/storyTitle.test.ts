import { describe, it, expect } from "vitest";
import { storyTitle, findStoryTitle, STORY_TITLE_Y } from "@/lib/phone/storyTitle";
import type { Overlay } from "@/lib/models/project";

describe("storyTitle", () => {
  it("trims the text", () => {
    const overlay = storyTitle("  hello  ", "top", 10);
    expect(overlay.text).toBe("hello");
  });

  it("starts at 0 and ends at the duration", () => {
    const overlay = storyTitle("hello", "top", 10);
    expect(overlay.start).toBe(0);
    expect(overlay.end).toBe(10);
  });

  it("gives end 3 when duration is 0", () => {
    const overlay = storyTitle("hello", "top", 0);
    expect(overlay.end).toBe(3);
  });

  it("sets y according to the slot", () => {
    expect(storyTitle("hello", "top", 10).y).toBe(STORY_TITLE_Y.top);
    expect(storyTitle("hello", "middle", 10).y).toBe(STORY_TITLE_Y.middle);
    expect(storyTitle("hello", "bottom", 10).y).toBe(STORY_TITLE_Y.bottom);
  });

  it("keeps x at 0.5", () => {
    const overlay = storyTitle("hello", "top", 10);
    expect(overlay.x).toBe(0.5);
  });
});

describe("findStoryTitle", () => {
  it("finds the same words ignoring surrounding spaces", () => {
    const overlays: Overlay[] = [
      {
        kind: "text",
        variant: "title",
        text: "  hello  ",
        start: 0,
        end: 10,
        x: 0.5,
        y: 0.2,
      } as Overlay,
    ];
    const found = findStoryTitle(overlays, "hello");
    expect(found).not.toBeNull();
    expect(found?.text).toBe("  hello  ");
  });

  it("returns null for other words", () => {
    const overlays: Overlay[] = [
      {
        kind: "text",
        variant: "title",
        text: "hello",
        start: 0,
        end: 10,
        x: 0.5,
        y: 0.2,
      } as Overlay,
    ];
    expect(findStoryTitle(overlays, "world")).toBeNull();
  });

  it("returns null for a banner with the same words", () => {
    const overlays: Overlay[] = [
      {
        kind: "text",
        variant: "banner",
        text: "hello",
        start: 0,
        end: 10,
        x: 0.5,
        y: 0.2,
      } as Overlay,
    ];
    expect(findStoryTitle(overlays, "hello")).toBeNull();
  });

  it("returns null for an empty list", () => {
    expect(findStoryTitle([], "hello")).toBeNull();
  });
});
