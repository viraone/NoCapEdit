import { beforeEach, describe, expect, it } from "vitest";
import { askWords } from "@/lib/phone/aiStyleLook";
import { useStoryReturn } from "@/lib/phone/storyReturn";

describe("useStoryReturn", () => {
  beforeEach(() => useStoryReturn.getState().leave());

  it("starts with no project", () => {
    expect(useStoryReturn.getState().projectId).toBeNull();
  });

  it("remembers the project the Text tool was opened from", () => {
    useStoryReturn.getState().arrive("project-1");
    expect(useStoryReturn.getState().projectId).toBe("project-1");
  });

  it("forgets the project on leave", () => {
    useStoryReturn.getState().arrive("project-1");
    useStoryReturn.getState().leave();
    expect(useStoryReturn.getState().projectId).toBeNull();
  });
});

describe("askWords", () => {
  it("trims the words on the title", () => {
    expect(askWords("  hello there  ", "fallback")).toBe("hello there");
  });

  it("falls back when the title has no words", () => {
    expect(askWords(null, "fallback")).toBe("fallback");
    expect(askWords(undefined, "fallback")).toBe("fallback");
    expect(askWords("   ", "fallback")).toBe("fallback");
  });

  it("cuts the words to 200 characters", () => {
    expect(askWords("a".repeat(250), "fallback")).toBe("a".repeat(200));
  });

  it("trims before cutting to 200", () => {
    expect(askWords(`  ${"a".repeat(250)}  `, "fallback")).toBe("a".repeat(200));
  });
});
