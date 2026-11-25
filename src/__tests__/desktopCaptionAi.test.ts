import { describe, expect, it } from "vitest";
import { captionFromReply, captionRequest, parseGeminiConfig } from "../../desktop/lib/captionAi.mjs";

describe("the Gemini config file", () => {
  it("reads the key file and a default model", () => {
    expect(parseGeminiConfig('{"apiKeyFile":"~/k/key"}', "/Users/x")).toEqual({ apiKeyFile: "/Users/x/k/key", model: "gemini-flash-latest" });
    expect(parseGeminiConfig('{"apiKeyFile":"/abs/key","model":"my-model-1"}', "/Users/x")).toEqual({ apiKeyFile: "/abs/key", model: "my-model-1" });
  });

  it("falls back to the default for a model name that could not be one", () => {
    expect(parseGeminiConfig('{"apiKeyFile":"/abs/key","model":"bad name"}', "/Users/x")?.model).toBe("gemini-flash-latest");
    expect(parseGeminiConfig('{"apiKeyFile":"/abs/key","model":"a/b"}', "/Users/x")?.model).toBe("gemini-flash-latest");
  });

  it("is null when a piece is missing or wrong", () => {
    expect(parseGeminiConfig('{"apiKeyFile":"key.txt"}', "/Users/x")).toBeNull();
    expect(parseGeminiConfig('{"model":"m"}', "/Users/x")).toBeNull();
    expect(parseGeminiConfig("not json", "/Users/x")).toBeNull();
    expect(parseGeminiConfig("null", "/Users/x")).toBeNull();
  });
});

describe("the caption request and reply", () => {
  it("sends the notes with instructions", () => {
    const body = captionRequest("  my notes ");
    expect(body.contents[0].parts[0].text).toContain("my notes");
    expect(body.contents[0].parts[0].text.endsWith(" ")).toBe(false);
    expect(body.systemInstruction.parts[0].text.length).toBeGreaterThan(50);
  });

  it("reads the caption out of the reply", () => {
    expect(captionFromReply({ candidates: [{ content: { parts: [{ text: '"Hello ' }, { text: 'world"' }] } }] })).toBe("Hello world");
    expect(captionFromReply({})).toBe("");
    expect(captionFromReply(null)).toBe("");
    expect(captionFromReply({ candidates: [{ content: { parts: [{ notText: 1 }] } }] })).toBe("");
  });
});
