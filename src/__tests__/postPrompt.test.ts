import { describe, it, expect } from "vitest";
import { buildUserPrompt, cleanHashtag, cleanHashtags, fitSource, hashtagsFromText, parsePostReply, postAsText } from "@/lib/ai/postPrompt";

describe("hashtags", () => {
  it("cleans a tag to # plus letters and digits", () => {
    expect(cleanHashtag("seattle comedy!")).toBe("#seattlecomedy");
    expect(cleanHashtag("##Open-Mic")).toBe("#OpenMic");
    expect(cleanHashtag("  ")).toBe("");
  });
  it("drops duplicates ignoring case and cuts to the limit", () => {
    expect(cleanHashtags(["#A", "a", "#b", "#c"], 2)).toEqual(["#A", "#b"]);
  });
  it("finds tags in free text", () => {
    expect(hashtagsFromText("Try #one, #Two and #one.")).toEqual(["#one", "#Two"]);
  });
});

describe("parsePostReply", () => {
  it("reads the JSON answer", () => {
    const r = parsePostReply('{"title":"\\"Costume Night\\"","caption":" Come laugh. ","hashtags":["comedy","#openmic","comedy"]}');
    expect(r).toEqual({ title: "Costume Night", caption: "Come laugh.", hashtags: ["#comedy", "#openmic"] });
  });
  it("reads JSON wrapped in a code fence and cuts hashtags to the limit", () => {
    const r = parsePostReply('```json\n{"title":"T","caption":"C","hashtags":["a","b","c"]}\n```', 2);
    expect(r.hashtags).toEqual(["#a", "#b"]);
  });
  it("falls back to labelled lines", () => {
    const r = parsePostReply("Title: Big night\nCaption: Line one\nline two\nHashtags: #fun #night");
    expect(r).toEqual({ title: "Big night", caption: "Line one\nline two", hashtags: ["#fun", "#night"] });
  });
  it("treats plain text as the caption and lifts its hashtags out", () => {
    const r = parsePostReply("What a night #fun #night");
    expect(r.caption).toBe("What a night");
    expect(r.hashtags).toEqual(["#fun", "#night"]);
  });
});

describe("prompt and text", () => {
  it("asks for the right number of hashtags and includes the notes", () => {
    const p = buildUserPrompt({ source: "hello", notes: "link in bio", tone: "funny", length: "short", platform: "tiktok" });
    expect(p).toContain("5 relevant hashtags");
    expect(p).toContain("Also mention: link in bio");
    expect(p).toContain("hello");
  });
  it("keeps a long source to its start", () => {
    expect(fitSource("a ".repeat(5000), 100).length).toBeLessThanOrEqual(102);
  });
  it("puts the hashtags under the caption", () => {
    expect(postAsText({ title: "T", caption: "Hi", hashtags: ["#a", "#b"] })).toBe("Hi\n\n#a #b");
  });
});
