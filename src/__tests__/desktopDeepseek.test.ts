import { describe, expect, it } from "vitest";
import { parseDeepseekConfig, keyFromFile, toDeepseekRequest, asGeminiReply } from "../../desktop/lib/deepseek.mjs";
import { coverRequest } from "../../desktop/lib/coverAi.mjs";
import { captionRequest } from "../../desktop/lib/captionAi.mjs";

describe("parseDeepseekConfig", () => {
  it("reads the key file and a default model", () => {
    expect(parseDeepseekConfig('{"apiKeyFile":"~/x/key"}', "/Users/x")).toEqual({ apiKeyFile: "/Users/x/x/key", model: "deepseek-flash" });
    expect(parseDeepseekConfig('{"apiKeyFile":"/abs/key","model":"deepseek-chat"}', "/Users/x")).toEqual({ apiKeyFile: "/abs/key", model: "deepseek-chat" });
  });

  it("falls back to the default for a model name that could not be one", () => {
    expect(parseDeepseekConfig('{"apiKeyFile":"/abs/key","model":"bad name"}', "/Users/x")?.model).toBe("deepseek-flash");
    expect(parseDeepseekConfig('{"apiKeyFile":"/abs/key","model":"a/b"}', "/Users/x")?.model).toBe("deepseek-flash");
  });

  it("is null when a piece is missing or wrong", () => {
    expect(parseDeepseekConfig('{"apiKeyFile":"key.txt"}', "/Users/x")).toBeNull();
    expect(parseDeepseekConfig('{"model":"m"}', "/Users/x")).toBeNull();
    expect(parseDeepseekConfig("not json", "/Users/x")).toBeNull();
    expect(parseDeepseekConfig("null", "/Users/x")).toBeNull();
  });
});

describe("keyFromFile", () => {
  it("finds DEEPSEEK_API_KEY", () => {
    expect(keyFromFile("DEEPSEEK_API_KEY=sk-test-1234567890")).toBe("sk-test-1234567890");
    expect(keyFromFile("export DEEPSEEK_API_KEY=sk-test-1234567890")).toBe("sk-test-1234567890");
    expect(keyFromFile('DEEPSEEK_API_KEY="sk-test-1234567890"')).toBe("sk-test-1234567890");
    expect(keyFromFile("DEEPSEEK_API_KEY='sk-test-1234567890'")).toBe("sk-test-1234567890");
  });

  it("finds ANTHROPIC_AUTH_TOKEN", () => {
    expect(keyFromFile("ANTHROPIC_AUTH_TOKEN=sk-test-1234567890")).toBe("sk-test-1234567890");
    expect(keyFromFile("export ANTHROPIC_AUTH_TOKEN=sk-test-1234567890")).toBe("sk-test-1234567890");
  });

  it("prefers DEEPSEEK_API_KEY over ANTHROPIC_AUTH_TOKEN", () => {
    expect(keyFromFile("ANTHROPIC_AUTH_TOKEN=sk-ant-1234567890\nDEEPSEEK_API_KEY=sk-ds-1234567890")).toBe("sk-ds-1234567890");
  });

  it("ignores comments", () => {
    expect(keyFromFile("# comment\nDEEPSEEK_API_KEY=sk-test-1234567890")).toBe("sk-test-1234567890");
  });

  it("treats a single token as the key", () => {
    expect(keyFromFile("sk-test-1234567890")).toBe("sk-test-1234567890");
  });

  it("returns empty for invalid keys", () => {
    expect(keyFromFile("short")).toBe("");
    expect(keyFromFile("has spaces here")).toBe("");
    expect(keyFromFile("has=newlines\nhere")).toBe("");
    expect(keyFromFile("")).toBe("");
  });
});

describe("toDeepseekRequest", () => {
  it("converts a text-only request", () => {
    const gemini = captionRequest("notes");
    const req = toDeepseekRequest(gemini, "deepseek-chat");
    expect(req.model).toBe("deepseek-chat");
    expect(req.messages[0].role).toBe("system");
    expect(typeof req.messages[0].content).toBe("string");
    expect(req.messages[1].role).toBe("user");
    expect(typeof req.messages[1].content).toBe("string");
    expect(req.messages[1].content).toContain("notes");
    expect(req.temperature).toBe(0.7);
    expect(req.max_tokens).toBe(2000);
    expect(req.thinking).toEqual({ type: "disabled" });
    expect(req.response_format).toBeUndefined();
  });

  it("converts a multimodal request", () => {
    const gemini = coverRequest(["AAAA"]);
    const req = toDeepseekRequest(gemini, "deepseek-chat");
    expect(Array.isArray(req.messages[1].content)).toBe(true);
    const content = req.messages[1].content;
    expect(content[0]).toEqual({ type: "text", text: "Frame 1" });
    expect(content[1]).toEqual({ type: "image_url", image_url: { url: "data:image/jpeg;base64,AAAA" } });
    expect(req.response_format).toEqual({ type: "json_object" });
  });
});

describe("asGeminiReply", () => {
  it("converts a chat completion", () => {
    const reply = { choices: [{ message: { content: "Hello" } }] };
    expect(asGeminiReply(reply)).toEqual({ candidates: [{ content: { parts: [{ text: "Hello" }] } }] });
  });

  it("returns empty object when no content", () => {
    expect(asGeminiReply({})).toEqual({});
    expect(asGeminiReply({ choices: [] })).toEqual({});
    expect(asGeminiReply({ choices: [{ message: {} }] })).toEqual({});
  });
});
