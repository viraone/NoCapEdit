import { describe, expect, it } from "vitest";
import { validCoverFrames, coverRequest, coverFromReply } from "../../desktop/lib/coverAi.mjs";
import { wallMinutes, thumbnailMinutes } from "../../desktop/lib/phone.mjs";

describe("validCoverFrames", () => {
  it("accepts a valid list", () => {
    expect(validCoverFrames(["abc", "def="])).toBe(true);
    expect(validCoverFrames(["A"])).toBe(true);
  });

  it("rejects empty array", () => {
    expect(validCoverFrames([])).toBe(false);
  });

  it("rejects more than 10", () => {
    const frames = Array.from({ length: 11 }, (_, i) => `f${i}`);
    expect(validCoverFrames(frames)).toBe(false);
  });

  it("rejects non-array", () => {
    expect(validCoverFrames("abc")).toBe(false);
    expect(validCoverFrames(null)).toBe(false);
  });

  it("rejects empty string entry", () => {
    expect(validCoverFrames([""])).toBe(false);
  });

  it("rejects invalid base64 chars", () => {
    expect(validCoverFrames(["abc!"])).toBe(false);
  });

  it("rejects too long entry", () => {
    const long = "a".repeat(600001);
    expect(validCoverFrames([long])).toBe(false);
  });

  it("accepts exactly 600000 chars", () => {
    const ok = "a".repeat(600000);
    expect(validCoverFrames([ok])).toBe(true);
  });
});

describe("coverRequest", () => {
  it("builds parts in correct order", () => {
    const body = coverRequest(["AAA", "BBB"]);
    const parts = body.contents[0].parts;
    expect(parts[0]).toEqual({ text: "Frame 1" });
    expect(parts[1]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "AAA" } });
    expect(parts[2]).toEqual({ text: "Frame 2" });
    expect(parts[3]).toEqual({ inlineData: { mimeType: "image/jpeg", data: "BBB" } });
  });

  it("has correct generationConfig", () => {
    const body = coverRequest(["x"]);
    expect(body.generationConfig).toEqual({
      temperature: 0.2,
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
    });
  });

  it("has systemInstruction with instructions", () => {
    const body = coverRequest(["x"]);
    expect(body.systemInstruction.parts[0].text).toContain("Instagram Highlight");
  });
});

describe("coverFromReply", () => {
  it("parses plain JSON", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":2,"center":0.5}' }] } }] };
    expect(coverFromReply(reply, 3)).toEqual({ frame: 1, center: 0.5 });
  });

  it("parses fenced JSON", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '```json\n{"frame":1,"center":0.3}\n```' }] } }] };
    expect(coverFromReply(reply, 2)).toEqual({ frame: 0, center: 0.3 });
  });

  it("parses ``` fence without json", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '```\n{"frame":1,"center":0.3}\n```' }] } }] };
    expect(coverFromReply(reply, 2)).toEqual({ frame: 0, center: 0.3 });
  });

  it("returns null for frame out of range", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":5,"center":0.5}' }] } }] };
    expect(coverFromReply(reply, 3)).toBeNull();
  });

  it("returns null for frame 0", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":0,"center":0.5}' }] } }] };
    expect(coverFromReply(reply, 3)).toBeNull();
  });

  it("returns null for non-integer frame", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":1.5,"center":0.5}' }] } }] };
    expect(coverFromReply(reply, 3)).toBeNull();
  });

  it("returns null for bad JSON", () => {
    const reply = { candidates: [{ content: { parts: [{ text: 'not json' }] } }] };
    expect(coverFromReply(reply, 3)).toBeNull();
  });

  it("returns null for missing parts", () => {
    expect(coverFromReply({}, 3)).toBeNull();
    expect(coverFromReply(null, 3)).toBeNull();
  });

  it("defaults center to 0.5 when missing", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":1}' }] } }] };
    expect(coverFromReply(reply, 2)).toEqual({ frame: 0, center: 0.5 });
  });

  it("clamps center 7 to 1", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":1,"center":7}' }] } }] };
    expect(coverFromReply(reply, 2)).toEqual({ frame: 0, center: 1 });
  });

  it("clamps negative center to 0", () => {
    const reply = { candidates: [{ content: { parts: [{ text: '{"frame":1,"center":-1}' }] } }] };
    expect(coverFromReply(reply, 2)).toEqual({ frame: 0, center: 0 });
  });
});

describe("wallMinutes", () => {
  it("parses valid datetime", () => {
    expect(wallMinutes("2026-11-25 23:27")).toBe(Date.UTC(2026, 10, 25, 23, 27) / 60000);
  });

  it("allows surrounding whitespace", () => {
    expect(wallMinutes("  2026-11-25 23:27  ")).toBe(Date.UTC(2026, 10, 25, 23, 27) / 60000);
  });

  it("returns null for bad format", () => {
    expect(wallMinutes("2026/11/25 23:27")).toBeNull();
    expect(wallMinutes("")).toBeNull();
    expect(wallMinutes("not a date")).toBeNull();
  });
});

describe("thumbnailMinutes", () => {
  it("parses 9:56 AM", () => {
    const label = "Selected Photo thumbnail created on November 24, 2026 9:56 AM";
    expect(thumbnailMinutes(label)).toBe(Date.UTC(2026, 10, 24, 9, 56) / 60000);
  });

  it("parses 12:05 AM as hour 0", () => {
    const label = "Selected Photo thumbnail created on November 24, 2026 12:05 AM";
    expect(thumbnailMinutes(label)).toBe(Date.UTC(2026, 10, 24, 0, 5) / 60000);
  });

  it("parses 12:05 PM as hour 12", () => {
    const label = "Selected Photo thumbnail created on November 24, 2026 12:05 PM";
    expect(thumbnailMinutes(label)).toBe(Date.UTC(2026, 10, 24, 12, 5) / 60000);
  });

  it("parses 11:30 PM", () => {
    const label = "Selected Photo thumbnail created on November 24, 2026 11:30 PM";
    expect(thumbnailMinutes(label)).toBe(Date.UTC(2026, 10, 24, 23, 30) / 60000);
  });

  it("handles U+202F before PM", () => {
    const label = "Selected Photo thumbnail created on November 24, 2026 11:30\u202fPM";
    expect(thumbnailMinutes(label)).toBe(Date.UTC(2026, 10, 24, 23, 30) / 60000);
  });

  it("returns null for non-matching label", () => {
    expect(thumbnailMinutes("no date here")).toBeNull();
    expect(thumbnailMinutes("")).toBeNull();
  });

  it("returns null for unknown month", () => {
    const label = "Selected Photo thumbnail created on Foo 24, 2026 9:56 AM";
    expect(thumbnailMinutes(label)).toBeNull();
  });

  it("matches wallMinutes for same time", () => {
    const thumb = "Selected Photo thumbnail created on November 25, 2026 11:27 PM";
    const wall = "2026-11-25 23:27";
    expect(thumbnailMinutes(thumb)).toBe(wallMinutes(wall));
  });
});
