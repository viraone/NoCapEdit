import { describe, expect, it } from "vitest";
import { cleanLinkUrl, STORY_SLOTS, storySlotY } from "../../desktop/lib/phone.mjs";

describe("where things go on a Story", () => {
  it("has the three slots in order", () => {
    expect(STORY_SLOTS).toEqual(["top", "middle", "bottom"]);
  });

  it("places each slot at the right height", () => {
    expect(storySlotY("top", 2424)).toBe(485);
    expect(storySlotY("middle", 2424)).toBe(1103);
    expect(storySlotY("bottom", 2424)).toBe(1648);
    expect(storySlotY("nope", 2424)).toBe(1103);
  });

  it("nudges the middle lower", () => {
    expect(storySlotY("middle", 2424, true)).toBe(1285);
  });

  it("keeps top < middle < bottom on any screen", () => {
    const top = storySlotY("top", 1920);
    const middle = storySlotY("middle", 1920);
    const bottom = storySlotY("bottom", 1920);
    expect(top).toBeLessThan(middle);
    expect(middle).toBeLessThan(bottom);
  });
});

describe("the link sticker's address", () => {
  it("adds https to a bare host", () => {
    expect(cleanLinkUrl("example.com/tickets")).toBe("https://example.com/tickets");
  });

  it("trims and keeps a full https url", () => {
    expect(cleanLinkUrl("  https://example.com/a?b=1  ")).toBe("https://example.com/a?b=1");
  });

  it("keeps http as written", () => {
    expect(cleanLinkUrl("http://x.co")).toBe("http://x.co");
  });

  it("treats a port as part of the host, not a scheme", () => {
    expect(cleanLinkUrl("host.com:8080/x")).toBe("https://host.com:8080/x");
  });

  it("rejects bad inputs", () => {
    expect(cleanLinkUrl("")).toBeNull();
    expect(cleanLinkUrl("   ")).toBeNull();
    expect(cleanLinkUrl("has space.com")).toBeNull();
    expect(cleanLinkUrl("javascript:alert(1)")).toBeNull();
    expect(cleanLinkUrl("intent://x")).toBeNull();
    expect(cleanLinkUrl("ftp://example.com/f")).toBeNull();
    expect(cleanLinkUrl("localhost")).toBeNull();
    expect(cleanLinkUrl("exämple.com")).toBeNull();
    expect(cleanLinkUrl("https://user:pw@example.com")).toBeNull();
    expect(cleanLinkUrl(5)).toBeNull();
    expect(cleanLinkUrl(null)).toBeNull();
    expect(cleanLinkUrl(undefined)).toBeNull();
    expect(cleanLinkUrl("a".repeat(190) + ".example.com")).toBeNull();
  });
});
