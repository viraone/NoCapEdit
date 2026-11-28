import { describe, expect, it } from "vitest";
import { titleMessages, titlesFromReply, validTitleAsk } from "../../desktop/lib/clipTitles.mjs";

describe("validTitleAsk", () => {
  it("accepts a good array", () => {
    expect(validTitleAsk(["hello world"])).toBe(true);
    expect(validTitleAsk(["a", "b", "c"])).toBe(true);
  });

  it("rejects an empty array", () => {
    expect(validTitleAsk([])).toBe(false);
  });

  it("rejects 13 items", () => {
    expect(validTitleAsk(Array.from({ length: 13 }, (_, i) => `clip ${i}`))).toBe(false);
  });

  it("rejects a non-string item", () => {
    expect(validTitleAsk(["ok", 5])).toBe(false);
    expect(validTitleAsk(["ok", null])).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validTitleAsk([""])).toBe(false);
    expect(validTitleAsk(["   "])).toBe(false);
  });

  it("rejects a 1501-char string", () => {
    expect(validTitleAsk(["x".repeat(1501)])).toBe(false);
    expect(validTitleAsk(["x".repeat(1500)])).toBe(true);
  });
});

describe("titleMessages", () => {
  it("numbers the clips and has two messages", () => {
    const msgs = titleMessages(["  first text  ", "second text"]);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("system");
    expect(msgs[1].role).toBe("user");
    expect(msgs[1].content).toBe("Clip 1:\nfirst text\n\nClip 2:\nsecond text");
  });
});

describe("titlesFromReply", () => {
  it("handles plain JSON", () => {
    const r = titlesFromReply('{"titles":["Airplane food","Bad dates"]}', 2);
    expect(r).toEqual(["Airplane food", "Bad dates"]);
  });

  it("handles JSON inside code fences", () => {
    const r = titlesFromReply('```json\n{"titles":["Airplane food"]}\n```', 1);
    expect(r).toEqual(["Airplane food"]);
  });

  it("handles text before the JSON", () => {
    const r = titlesFromReply('Sure! Here you go: {"titles":["Airplane food"]}', 1);
    expect(r).toEqual(["Airplane food"]);
  });

  it("pads a short titles array with empty strings", () => {
    const r = titlesFromReply('{"titles":["Only one"]}', 3);
    expect(r).toEqual(["Only one", "", ""]);
  });

  it("applies the cleaning rules", () => {
    const r = titlesFromReply('{"titles":["  12.   \\"Airplane food.\\"  "]}', 1);
    expect(r).toEqual(["Airplane food"]);
  });

  it("keeps an apostrophe inside a title", () => {
    expect(titlesFromReply('{"titles":["Dad\'s old car"]}', 1)).toEqual(["Dad's old car"]);
  });

  it("cuts a long title to 60 characters", () => {
    const long = "a".repeat(80);
    const r = titlesFromReply(`{"titles":["${long}"]}`, 1);
    expect(r).not.toBeNull();
    expect(r![0]).toHaveLength(60);
  });

  it("returns null for garbage", () => {
    expect(titlesFromReply("not json at all", 1)).toBeNull();
    expect(titlesFromReply(123, 1)).toBeNull();
  });

  it("returns null when every title is empty", () => {
    expect(titlesFromReply('{"titles":["", "   "]}', 2)).toBeNull();
  });
});
