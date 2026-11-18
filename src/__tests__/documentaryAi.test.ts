import { describe, expect, it } from "vitest";
import { aiMissing, modelRequest } from "@/lib/documentary/ai";
import { DEFAULT_AI_SETTINGS, type AiSettings } from "@/lib/edit/aiHighlights";

const settings = (patch: Partial<AiSettings>): AiSettings => ({ ...DEFAULT_AI_SETTINGS, ...patch });

describe("aiMissing", () => {
  it("asks for the key of the chosen provider only", () => {
    expect(aiMissing(settings({ provider: "anthropic" }))).toMatch(/Anthropic/);
    expect(aiMissing(settings({ provider: "anthropic", anthropicKey: "sk-x" }))).toBeNull();
    expect(aiMissing(settings({ provider: "deepseek" }))).toMatch(/DeepSeek/);
    expect(aiMissing(settings({ provider: "ollama" }))).toBeNull();
  });
});

describe("modelRequest", () => {
  it("builds a Claude Messages call and reads its text blocks", () => {
    const req = modelRequest(settings({ provider: "anthropic", anthropicKey: "sk-x", anthropicModel: "claude-sonnet-5-5" }), "SYS", "USER");
    expect(req.url).toBe("https://api.anthropic.com/v1/messages");
    expect(req.headers["x-api-key"]).toBe("sk-x");
    expect(req.body).toMatchObject({ model: "claude-sonnet-5-5", system: "SYS", messages: [{ role: "user", content: "USER" }] });
    expect(req.readText({ content: [{ type: "text", text: "a" }, { type: "tool_use" }, { type: "text", text: "b" }] })).toBe("a\nb");
  });

  it("builds an OpenAI-style call for DeepSeek and reads the first choice", () => {
    const req = modelRequest(settings({ provider: "deepseek", deepseekKey: "k", deepseekModel: "deepseek-chat" }), "S", "U");
    expect(req.url).toBe("https://api.deepseek.com/chat/completions");
    expect(req.headers.Authorization).toBe("Bearer k");
    expect(req.readText({ choices: [{ message: { content: "hi" } }] })).toBe("hi");
    expect(req.readText({})).toBe("");
  });

  it("builds a Gemini call and Ollama call", () => {
    const g = modelRequest(settings({ provider: "gemini", geminiKey: "g", geminiModel: "gemini-x" }), "S", "U");
    expect(g.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-x:generateContent");
    expect(g.headers["x-goog-api-key"]).toBe("g");
    expect(g.readText({ candidates: [{ content: { parts: [{ text: "o" }, { text: "k" }] } }] })).toBe("ok");
    const o = modelRequest(settings({ provider: "ollama", endpoint: "http://localhost:11434/" }), "S", "U");
    expect(o.url).toBe("http://localhost:11434/api/chat");
    expect(o.readText({ message: { content: "yo" } })).toBe("yo");
  });
});
