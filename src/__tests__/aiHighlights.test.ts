import { afterEach, describe, expect, it, vi } from "vitest";
import { activeModel, anthropicRequestBody, buildAiPrompt, geminiRequestBody, parseGeminiClips, toGeminiSchema, clipsToHighlights, contextFor, DEFAULT_AI_SETTINGS, findAiHighlights, isCloudProvider, loadAiSettings, openAiRequestBody, parseAnthropicClips, parseClips, transcriptLines, type AiClip, type AiSettings } from "@/lib/edit/aiHighlights";
import type { Sentence } from "@/lib/edit/highlights";
import type { CaptionCue } from "@/lib/models/project";

/** Ten 5-second sentences back to back: line i spans [i*5, i*5+5). */
const sentences: Sentence[] = Array.from({ length: 10 }, (_, i) => ({ text: `Sentence ${i}.`, start: i * 5, end: i * 5 + 5, words: 2 }));
const opts = { count: 5, minSeconds: 15, maxSeconds: 30 };
const clip = (startLine: number, endLine: number, score = 5, extra: Partial<AiClip> = {}): AiClip => ({ startLine, endLine, score, title: `T${startLine}`, hook: "h", reason: "r", ...extra });

describe("transcriptLines / buildAiPrompt", () => {
  it("numbers each sentence with its start-end seconds", () => {
    expect(transcriptLines(sentences.slice(0, 2))).toBe("[0] 0.0-5.0 Sentence 0.\n[1] 5.0-10.0 Sentence 1.");
  });
  it("puts the count and the length window in the request", () => {
    const { user, system } = buildAiPrompt(sentences, { count: 4, minSeconds: 18, maxSeconds: 48 });
    expect(user).toContain("Pick the 4 best clips");
    expect(user).toContain("between 18 and 48 seconds");
    expect(system).toMatch(/Never pick intros, outros/);
  });
});

describe("clipsToHighlights", () => {
  it("keeps a valid clip and orders the result best first", () => {
    const out = clipsToHighlights([clip(0, 3, 6), clip(5, 8, 9)], sentences, opts);
    expect(out.map((h) => [h.start, h.end, h.score])).toEqual([
      [25, 45, 9],
      [0, 20, 6],
    ]);
    expect(out[0].title).toBe("T5");
    expect(out[0].text).toBe("Sentence 5. Sentence 6. Sentence 7. Sentence 8.");
  });
  it("extends a clip that is too short and trims one that is too long", () => {
    expect(clipsToHighlights([clip(2, 2)], sentences, opts)[0]).toMatchObject({ start: 10, end: 25 });
    expect(clipsToHighlights([clip(0, 9)], sentences, opts)[0]).toMatchObject({ start: 0, end: 30 });
  });
  it("drops out-of-range, reversed and overlapping clips", () => {
    const out = clipsToHighlights([clip(-1, 2), clip(4, 99), clip(6, 3), clip(0, 3, 8), clip(2, 5, 7)], sentences, opts);
    expect(out.map((h) => [h.start, h.end])).toEqual([[0, 20]]);
  });
  it("does not stretch a clip across a long pause", () => {
    const gappy: Sentence[] = [
      { text: "a", start: 0, end: 5, words: 1 },
      { text: "b", start: 20, end: 25, words: 1 },
    ];
    expect(clipsToHighlights([clip(0, 0)], gappy, opts)).toEqual([]);
  });
  it("caps the result at the requested count", () => {
    expect(clipsToHighlights([clip(0, 2), clip(3, 5), clip(6, 8)], sentences, { ...opts, count: 2 })).toHaveLength(2);
  });
});

describe("contextFor", () => {
  it("asks for enough context in 4k steps, between 8k and 32k", () => {
    expect(contextFor(1000)).toBe(8192);
    expect(contextFor(9000)).toBe(12288);
    expect(contextFor(40000)).toBe(32768);
  });
});

describe("findAiHighlights", () => {
  afterEach(() => vi.unstubAllGlobals());
  const cues: CaptionCue[] = sentences.map((s, i) => ({ id: `c${i}`, start: s.start, end: s.end, text: s.text }));
  const settings: AiSettings = { ...DEFAULT_AI_SETTINGS, endpoint: "http://localhost:11434/", model: "qwen3.8:27b" };

  /** A streamed Ollama /api/chat reply that spells the JSON out in small pieces. */
  function ollamaStream(json: string): Response {
    const pieces: string[] = [];
    for (let i = 0; i < json.length; i += 7) pieces.push(json.slice(i, i + 7));
    const lines = [...pieces.map((p) => JSON.stringify({ message: { content: p }, done: false })), JSON.stringify({ done: true })];
    const body = new ReadableStream({
      start(c) {
        for (const l of lines) c.enqueue(new TextEncoder().encode(l + "\n"));
        c.close();
      },
    });
    return new Response(body, { status: 200 });
  }

  it("posts the transcript with the schema and turns the streamed answer into highlights", async () => {
    const fetchMock = vi.fn(async () => ollamaStream(JSON.stringify({ clips: [clip(1, 4, 8, { title: "Best bit" })] })));
    vi.stubGlobal("fetch", fetchMock);
    const progress: string[] = [];
    const out = await findAiHighlights(cues, { settings, ...opts, onProgress: (m) => progress.push(m) });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ start: 5, end: 25, title: "Best bit", score: 8 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "qwen3.8:27b", stream: true, think: false });
    expect(body.format.required).toEqual(["clips"]);
    expect(body.messages[1].content).toContain("[3] 15.0-20.0 Sentence 3.");
    expect(progress[0]).toContain("qwen3.8:27b");
  });

  it("explains an unreachable server and a missing model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    await expect(findAiHighlights(cues, { settings, ...opts })).rejects.toThrow(/Couldn't reach Ollama at http:\/\/localhost:11434/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":"model \\"nope\\" not found"}', { status: 404 })));
    await expect(findAiHighlights(cues, { settings: { ...settings, model: "nope" }, ...opts })).rejects.toThrow("ollama pull nope");
  });

  it("reports a cancel as an AbortError and refuses a transcript with too little speech", async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new DOMException("aborted", "AbortError"))));
    await expect(findAiHighlights(cues, { settings, ...opts, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    await expect(findAiHighlights(cues.slice(0, 2), { settings, ...opts })).rejects.toThrow(/too short to cut reels|enough speech/);
  });

  describe("OpenAI-compatible provider", () => {
    const cloud: AiSettings = { ...settings, provider: "openai", apiBase: "https://api.example.com/v1/", apiKey: "sk-test", apiModel: "gpt-4o-mini" };
    const answer = (content: string, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

    it("posts the transcript as a chat completion with the schema and the user's key", async () => {
      const fetchMock = vi.fn(async () => answer(JSON.stringify({ clips: [clip(1, 4, 8, { title: "Best bit" })] })));
      vi.stubGlobal("fetch", fetchMock);
      const progress: string[] = [];
      const out = await findAiHighlights(cues, { settings: cloud, ...opts, onProgress: (m) => progress.push(m) });
      expect(out[0]).toMatchObject({ start: 5, end: 25, title: "Best bit", score: 8 });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.example.com/v1/chat/completions");
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.response_format.type).toBe("json_schema");
      expect(body.messages[1].content).toContain("[3] 15.0-20.0 Sentence 3.");
      expect(progress[0]).toContain("gpt-4o-mini");
      expect(progress[0]).toContain("api.example.com");
    });

    it("falls back to json_object when the API has no structured outputs, and reads fenced JSON", async () => {
      const fenced = "```json\n" + JSON.stringify({ clips: [clip(1, 4, 7)] }) + "\n```";
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(new Response('{"error":{"message":"response_format json_schema is not supported"}}', { status: 400 }))
        .mockResolvedValueOnce(answer(fenced));
      vi.stubGlobal("fetch", fetchMock);
      const out = await findAiHighlights(cues, { settings: cloud, ...opts });
      expect(out).toHaveLength(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const second = JSON.parse(String((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body));
      expect(second.response_format).toEqual({ type: "json_object" });
      expect(second.messages[1].content).toContain('{"clips":[');
    });

    it("explains a rejected key, a missing model and a missing key", async () => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
      await expect(findAiHighlights(cues, { settings: cloud, ...opts })).rejects.toThrow(/API key was rejected/);
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));
      await expect(findAiHighlights(cues, { settings: cloud, ...opts })).rejects.toThrow(/"gpt-4o-mini" wasn't found/);
      vi.stubGlobal("fetch", vi.fn());
      await expect(findAiHighlights(cues, { settings: { ...cloud, apiKey: "" }, ...opts })).rejects.toThrow(/Add your API key/);
    });

  });

  describe("Anthropic provider", () => {
    const claude: AiSettings = { ...settings, provider: "anthropic", anthropicKey: "sk-ant-test", anthropicModel: "claude-sonnet-5-5" };
    const toolAnswer = (input: unknown, status = 200) => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "clips", input }] }), { status });

    it("posts the transcript to the Messages API as a forced tool call with the user's key", async () => {
      const fetchMock = vi.fn(async () => toolAnswer({ clips: [clip(1, 4, 9, { title: "Best bit" })] }));
      vi.stubGlobal("fetch", fetchMock);
      const progress: string[] = [];
      const out = await findAiHighlights(cues, { settings: claude, ...opts, onProgress: (m) => progress.push(m) });
      expect(out[0]).toMatchObject({ start: 5, end: 25, title: "Best bit", score: 9 });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("sk-ant-test");
      expect(headers["anthropic-version"]).toBe("2023-06-01");
      expect(headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("claude-sonnet-5-5");
      expect(body.tool_choice).toEqual({ type: "tool", name: "clips" });
      expect(body.tools[0].input_schema.required).toEqual(["clips"]);
      expect(body.system).toContain("clips");
      expect(body.messages[0].content).toContain("[3] 15.0-20.0 Sentence 3.");
      expect(progress[0]).toContain("claude-sonnet-5-5");
    });

    it("reads a text answer when the model skipped the tool, and explains errors", async () => {
      expect(parseAnthropicClips({ content: [{ type: "text", text: '{"clips":[{"startLine":1,"endLine":2,"score":5}]}' }] })).toHaveLength(1);
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"type":"authentication_error","message":"invalid x-api-key"}}', { status: 401 })));
      await expect(findAiHighlights(cues, { settings: claude, ...opts })).rejects.toThrow(/rejected the API key/);
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"type":"not_found_error","message":"model: nope"}}', { status: 404 })));
      await expect(findAiHighlights(cues, { settings: { ...claude, anthropicModel: "nope" }, ...opts })).rejects.toThrow(/"nope" wasn't found/);
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"type":"invalid_request_error","message":"max_tokens too large"}}', { status: 400 })));
      await expect(findAiHighlights(cues, { settings: claude, ...opts })).rejects.toThrow(/400: max_tokens too large/);
      vi.stubGlobal("fetch", vi.fn());
      await expect(findAiHighlights(cues, { settings: { ...claude, anthropicKey: "" }, ...opts })).rejects.toThrow(/Anthropic API key/);
      expect(anthropicRequestBody("m", "sys", "usr").max_tokens).toBe(4096);
    });

  });

  describe("Gemini provider", () => {
    const gem: AiSettings = { ...settings, provider: "gemini", geminiKey: "AIza-test", geminiModel: "gemini-2.5-flash" };
    const answer = (text: string, status = 200) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }), { status });

    it("posts the transcript to generateContent with a JSON response schema and the user's key", async () => {
      const fetchMock = vi.fn(async () => answer(JSON.stringify({ clips: [clip(1, 4, 7, { title: "Best bit" })] })));
      vi.stubGlobal("fetch", fetchMock);
      const progress: string[] = [];
      const out = await findAiHighlights(cues, { settings: gem, ...opts, onProgress: (m) => progress.push(m) });
      expect(out[0]).toMatchObject({ start: 5, end: 25, title: "Best bit", score: 7 });
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
      expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("AIza-test");
      const body = JSON.parse(String(init.body));
      expect(body.systemInstruction.parts[0].text).toContain("clips");
      expect(body.contents[0].parts[0].text).toContain("[3] 15.0-20.0 Sentence 3.");
      expect(body.generationConfig.responseMimeType).toBe("application/json");
      expect(body.generationConfig.responseSchema.type).toBe("OBJECT");
      expect(body.generationConfig.responseSchema.properties.clips.items.properties.score.type).toBe("INTEGER");
      expect(body.generationConfig.responseSchema.required).toEqual(["clips"]);
      expect(progress[0]).toContain("gemini-2.5-flash");
    });

    it("converts the schema, reads blocked or truncated answers, and explains errors", async () => {
      expect(toGeminiSchema({ type: "object", additionalProperties: false, properties: { a: { type: "array", items: { type: "string" } } } })).toEqual({ type: "OBJECT", properties: { a: { type: "ARRAY", items: { type: "STRING" } } } });
      expect(() => parseGeminiClips({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(/declined/);
      expect(() => parseGeminiClips({ candidates: [{ finishReason: "MAX_TOKENS" }] })).toThrow(/stopped early/);
      expect(parseGeminiClips({ candidates: [{ content: { parts: [{ text: '{"clips":' }, { text: "[]}" }] } }] })).toEqual([]);
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}', { status: 400 })));
      await expect(findAiHighlights(cues, { settings: gem, ...opts })).rejects.toThrow(/rejected the API key/);
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":404,"message":"models/nope is not found"}}', { status: 404 })));
      await expect(findAiHighlights(cues, { settings: { ...gem, geminiModel: "nope" }, ...opts })).rejects.toThrow(/"nope" wasn't found/);
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"error":{"code":429,"message":"quota"}}', { status: 429 })));
      await expect(findAiHighlights(cues, { settings: gem, ...opts })).rejects.toThrow(/429/);
      vi.stubGlobal("fetch", vi.fn());
      await expect(findAiHighlights(cues, { settings: { ...gem, geminiKey: "" }, ...opts })).rejects.toThrow(/Google AI Studio API key/);
      expect(geminiRequestBody("sys", "usr").generationConfig).toMatchObject({ responseMimeType: "application/json" });
    });

    it("never touches the cloud when Ollama is the provider", async () => {
      const fetchMock = vi.fn(async () => ollamaStream(JSON.stringify({ clips: [clip(1, 4, 8)] })));
      vi.stubGlobal("fetch", fetchMock);
      await findAiHighlights(cues, { settings: { ...gem, provider: "ollama", apiKey: "sk-test", anthropicKey: "sk-ant-test" }, ...opts });
      expect(String((fetchMock.mock.calls[0] as unknown as [string])[0])).toBe("http://localhost:11434/api/chat");
    });
  });
});

describe("AI settings", () => {
  const store = new Map<string, string>();
  const localStorageMock = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
  afterEach(() => {
    store.clear();
    vi.unstubAllGlobals();
  });

  it("defaults to Ollama on this computer with the local model", () => {
    vi.stubGlobal("localStorage", localStorageMock);
    expect(loadAiSettings()).toEqual(DEFAULT_AI_SETTINGS);
    expect(DEFAULT_AI_SETTINGS.provider).toBe("ollama");
    expect(isCloudProvider("ollama")).toBe(false);
    expect(isCloudProvider("anthropic")).toBe(true);
    expect(activeModel(DEFAULT_AI_SETTINGS)).toBe("qwen3.8:27b");
  });

  it("keeps settings saved before the provider option existed on the local model", () => {
    vi.stubGlobal("localStorage", localStorageMock);
    store.set("reelflow.ai", JSON.stringify({ endpoint: "http://localhost:11434", model: "qwen3.8:27b" }));
    const s = loadAiSettings();
    expect(s.provider).toBe("ollama");
    expect(activeModel(s)).toBe("qwen3.8:27b");
    expect(s.apiKey).toBe("");
  });

  it("only uses the cloud model when the provider was switched on purpose", () => {
    vi.stubGlobal("localStorage", localStorageMock);
    store.set("reelflow.ai", JSON.stringify({ provider: "openai", apiBase: "https://api.openai.com/v1/", apiKey: " sk-x ", apiModel: "gpt-4o-mini" }));
    const s = loadAiSettings();
    expect(s).toMatchObject({ provider: "openai", apiBase: "https://api.openai.com/v1", apiKey: "sk-x", model: "qwen3.8:27b" });
    expect(activeModel(s)).toBe("gpt-4o-mini");
    store.set("reelflow.ai", JSON.stringify({ provider: "anthropic", anthropicKey: "sk-ant-x" }));
    const a = loadAiSettings();
    expect(a).toMatchObject({ provider: "anthropic", anthropicKey: "sk-ant-x", anthropicModel: "claude-sonnet-5-5", model: "qwen3.8:27b" });
    expect(activeModel(a)).toBe("claude-sonnet-5-5");
    store.set("reelflow.ai", JSON.stringify({ provider: "gemini", geminiKey: "AIza-x" }));
    const g = loadAiSettings();
    expect(g).toMatchObject({ provider: "gemini", geminiKey: "AIza-x", geminiModel: "gemini-2.5-flash", model: "qwen3.8:27b" });
    expect(activeModel(g)).toBe("gemini-2.5-flash");
  });

  it("parses plain, fenced and broken answers", () => {
    expect(parseClips('{"clips":[]}')).toEqual([]);
    expect(parseClips('Sure!\n```json\n{"clips":[{"startLine":1,"endLine":2,"score":5}]}\n```')).toHaveLength(1);
    expect(() => parseClips("no json here")).toThrow(/valid JSON/);
    expect(openAiRequestBody("m", "sys", "usr", "json_schema").response_format).toMatchObject({ type: "json_schema" });
  });
});
