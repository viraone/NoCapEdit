import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAiPrompt, clipsToHighlights, contextFor, findAiHighlights, transcriptLines, type AiClip } from "@/lib/edit/aiHighlights";
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
  const settings = { endpoint: "http://localhost:11434/", model: "qwen3.8:27b" };

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
});
