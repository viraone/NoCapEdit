/**
 * Highlight finder backed by a local LLM served by Ollama (http://localhost:11434).
 *
 * The transcript is sent as numbered sentences with timestamps; the model returns
 * the best standalone moments as line ranges (JSON constrained by a schema). The
 * answer is never trusted blindly: clipsToHighlights() drops invalid ranges,
 * stretches or trims clips to the requested length on sentence boundaries, and
 * removes overlaps. Everything stays on this machine.
 */
import type { CaptionCue } from "@/lib/models/project";
import { sentencesFromCues, type Highlight, type Sentence } from "./highlights";

export type AiProvider = "ollama" | "openai" | "anthropic" | "gemini";

export interface AiSettings {
  /** Where the model runs: Ollama on this computer (default, private) or an OpenAI-compatible HTTP API. */
  provider: AiProvider;
  /** Ollama server, e.g. http://localhost:11434 */
  endpoint: string;
  /** Ollama model name, e.g. qwen3.8:27b */
  model: string;
  /** OpenAI-compatible base URL, e.g. https://api.openai.com/v1 (also Groq, OpenRouter, LM Studio, Ollama's /v1). */
  apiBase: string;
  /** The user's own key for that API; kept in this browser only. */
  apiKey: string;
  /** Model name at that API, e.g. gpt-4o-mini. */
  apiModel: string;
  /** The user's Anthropic API key; kept in this browser only. */
  anthropicKey: string;
  /** Claude model id, e.g. claude-sonnet-5-5. */
  anthropicModel: string;
  /** The user's Google AI Studio key; kept in this browser only. */
  geminiKey: string;
  /** Gemini model id, e.g. gemini-2.5-flash. */
  geminiModel: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "ollama",
  endpoint: "http://localhost:11434",
  model: "qwen3.8:27b",
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  apiModel: "gpt-4o-mini",
  anthropicKey: "",
  anthropicModel: "claude-sonnet-5-5",
  geminiKey: "",
  geminiModel: "gemini-2.5-flash",
};
export const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
export const ANTHROPIC_API = "https://api.anthropic.com/v1";
const ANTHROPIC_VERSION = "2023-06-01";
const SETTINGS_KEY = "reelflow.ai";

const str = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim() : fallback);

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AiSettings>) : {};
    return {
      provider: parsed.provider === "openai" || parsed.provider === "anthropic" || parsed.provider === "gemini" ? parsed.provider : "ollama",
      endpoint: str(parsed.endpoint, DEFAULT_AI_SETTINGS.endpoint),
      model: str(parsed.model, DEFAULT_AI_SETTINGS.model),
      apiBase: str(parsed.apiBase, DEFAULT_AI_SETTINGS.apiBase).replace(/\/+$/, ""),
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey.trim() : "",
      apiModel: str(parsed.apiModel, DEFAULT_AI_SETTINGS.apiModel),
      anthropicKey: typeof parsed.anthropicKey === "string" ? parsed.anthropicKey.trim() : "",
      anthropicModel: str(parsed.anthropicModel, DEFAULT_AI_SETTINGS.anthropicModel),
      geminiKey: typeof parsed.geminiKey === "string" ? parsed.geminiKey.trim() : "",
      geminiModel: str(parsed.geminiModel, DEFAULT_AI_SETTINGS.geminiModel),
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
}

/** The model name a run will use for the chosen provider. */
export function activeModel(s: AiSettings): string {
  switch (s.provider) {
    case "openai":
      return s.apiModel;
    case "anthropic":
      return s.anthropicModel;
    case "gemini":
      return s.geminiModel;
    default:
      return s.model;
  }
}

/** True when the chosen provider sends the transcript off this device. */
export function isCloudProvider(p: AiProvider): boolean {
  return p !== "ollama";
}

export function saveAiSettings(settings: AiSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

const FINDER_KEY = "reelflow.highlightFinder";

/** The Highlights finder last picked on this machine ("stats" unless Local AI was chosen). */
export function loadHighlightFinder(): "stats" | "ai" {
  try {
    return localStorage.getItem(FINDER_KEY) === "ai" ? "ai" : "stats";
  } catch {
    return "stats";
  }
}

export function saveHighlightFinder(finder: "stats" | "ai"): void {
  try {
    localStorage.setItem(FINDER_KEY, finder);
  } catch {
    /* storage unavailable */
  }
}

/**
 * The local AI finder is a personal, machine-local feature: it is offered when the
 * app runs on localhost, or anywhere once localStorage `reelflow.localAi` is "1".
 */
export function localAiEnabled(): boolean {
  try {
    if (typeof location !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return true;
    return localStorage.getItem("reelflow.localAi") === "1";
  } catch {
    return false;
  }
}

/** What the model returns for one clip (line numbers refer to transcriptLines()). */
export interface AiClip {
  startLine: number;
  endLine: number;
  title: string;
  hook: string;
  reason: string;
  score: number;
}

export const AI_CLIPS_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startLine: { type: "integer" },
          endLine: { type: "integer" },
          title: { type: "string" },
          hook: { type: "string" },
          reason: { type: "string" },
          score: { type: "integer" },
        },
        required: ["startLine", "endLine", "title", "hook", "reason", "score"],
      },
    },
  },
  required: ["clips"],
} as const;

export interface AiRequestOptions {
  /** How many clips to ask for. */
  count: number;
  /** Shortest acceptable clip, seconds. */
  minSeconds: number;
  /** Longest acceptable clip, seconds. */
  maxSeconds: number;
}

/** "[12] 45.2-49.8 sentence text", one line per sentence. */
export function transcriptLines(sentences: Sentence[]): string {
  return sentences.map((s, i) => `[${i}] ${s.start.toFixed(1)}-${s.end.toFixed(1)} ${s.text.trim()}`).join("\n");
}

export function buildAiPrompt(sentences: Sentence[], opts: AiRequestOptions): { system: string; user: string } {
  const system =
    "You are a short-form video editor. You read a numbered, timestamped transcript of a long video and pick the moments that make the best standalone reels for TikTok, Instagram Reels and YouTube Shorts. " +
    "A good clip opens with a hook, makes sense without the rest of the video, and ends on a payoff or punchline. " +
    "Never pick intros, outros, sponsor reads, requests to like or subscribe, housekeeping, or filler. " +
    "Clips must not overlap. Refer to transcript lines by their numbers; the times after each number are start-end seconds. Return the clips best first.";
  const user =
    `Pick the ${opts.count} best clips. Each clip must be between ${Math.round(opts.minSeconds)} and ${Math.round(opts.maxSeconds)} seconds long (use the line times). ` +
    `Score each from 1 to 10. Give each a short title, the hook (its opening line), and one sentence on why it works.\n\nTranscript:\n${transcriptLines(sentences)}`;
  return { system, user };
}

/**
 * Turns the model's line ranges into validated, non-overlapping highlights: invalid
 * or out-of-range lines are dropped, a clip that is too short is extended forward
 * through contiguous sentences, one that is too long is trimmed from the end, and
 * a clip that still overlaps a better one is skipped. Best score first.
 */
export function clipsToHighlights(clips: AiClip[], sentences: Sentence[], opts: AiRequestOptions): Highlight[] {
  const n = sentences.length;
  const out: Highlight[] = [];
  const valid = clips.filter((c) => Number.isInteger(c.startLine) && Number.isInteger(c.endLine) && c.startLine >= 0 && c.endLine < n && c.startLine <= c.endLine);
  const byScore = [...valid].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  for (const c of byScore) {
    const s = c.startLine;
    let e = c.endLine;
    const len = () => sentences[e].end - sentences[s].start;
    // Too short: take in the following sentences while they follow on without a long pause.
    while (len() < opts.minSeconds && e + 1 < n && sentences[e + 1].start - sentences[e].end < 2) e++;
    // Too long: drop sentences from the end (one sentence longer than the limit is kept as is).
    while (len() > opts.maxSeconds && e > s) e--;
    if (len() < opts.minSeconds * 0.8) continue;
    const start = sentences[s].start;
    const end = sentences[e].end;
    if (out.some((h) => start < h.end && end > h.start)) continue;
    out.push({
      start,
      end,
      score: Math.max(1, Math.min(10, Math.round(c.score ?? 0))),
      text: sentences.slice(s, e + 1).map((x) => x.text.trim()).join(" "),
      reasons: c.reason?.trim() ? [c.reason.trim()] : [],
      title: c.title?.trim() || undefined,
      hook: c.hook?.trim() || undefined,
    });
    if (out.length >= opts.count) break;
  }
  return out;
}

/** Rough token estimate (English averages ~3.5-4 characters per token). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Context window to request: prompt plus room for the answer, in 4k steps. */
export function contextFor(promptTokens: number): number {
  return Math.min(32768, Math.max(8192, Math.ceil((promptTokens + 2048) / 4096) * 4096));
}

const MAX_PROMPT_TOKENS = 30000;

export interface FindAiOptions extends AiRequestOptions {
  settings: AiSettings;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

/** Parses the model's JSON answer into clips; throws a readable error when it is not JSON. */
export function parseClips(content: string): AiClip[] {
  try {
    return (JSON.parse(content) as { clips?: AiClip[] }).clips ?? [];
  } catch {
    // Some providers wrap JSON in a code fence despite being asked not to.
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return (JSON.parse(m[0]) as { clips?: AiClip[] }).clips ?? [];
      } catch {
        /* fall through */
      }
    }
    throw new Error("The model's answer wasn't valid JSON. Try again.");
  }
}

/** Request body for an OpenAI-compatible chat completion (json_schema first; callers may retry with json_object). */
export function openAiRequestBody(model: string, system: string, user: string, mode: "json_schema" | "json_object"): Record<string, unknown> {
  return {
    model,
    temperature: 0.2,
    messages: [
      { role: "system", content: system },
      { role: "user", content: mode === "json_object" ? `${user}\n\nAnswer with a JSON object of the form {"clips":[{"startLine":0,"endLine":0,"title":"","hook":"","reason":"","score":0}]} and nothing else.` : user },
    ],
    response_format: mode === "json_schema" ? { type: "json_schema", json_schema: { name: "clips", schema: AI_CLIPS_SCHEMA } } : { type: "json_object" },
  };
}

/** Sends the transcript to an OpenAI-compatible API with the user's own key. The transcript (not the video) leaves the device. */
async function findViaOpenAi(system: string, user: string, opts: FindAiOptions): Promise<AiClip[]> {
  const { apiBase, apiKey, apiModel } = opts.settings;
  if (!apiKey) throw new Error("Add your API key in the Model section first.");
  const base = apiBase.replace(/\/+$/, "");
  const call = async (mode: "json_schema" | "json_object") => {
    let res: Response;
    try {
      res = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: opts.signal,
        body: JSON.stringify(openAiRequestBody(apiModel, system, user, mode)),
      });
    } catch (e) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      throw new Error(`Couldn't reach ${base}. Check the base URL and your connection.`, { cause: e });
    }
    return res;
  };
  opts.onProgress?.(`Sending the transcript to ${apiModel} at ${new URL(base).host}`);
  let res = await call("json_schema");
  if (res.status === 400) {
    // Providers without structured outputs: ask for a plain JSON object instead.
    const text = await res.text().catch(() => "");
    if (/response_format|json_schema/i.test(text)) res = await call("json_object");
    else throw new Error(`The API rejected the request (400)${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 401) throw new Error("The API key was rejected (401). Check it in the Model section.");
    if (res.status === 404) throw new Error(`The model "${apiModel}" wasn't found at ${base} (404). Pick one from the list.`);
    if (res.status === 429) throw new Error("The API is rate-limiting or out of quota (429). Try again in a minute.");
    throw new Error(`The API returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  opts.onProgress?.(`${apiModel} is choosing clips`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content ?? "";
  return parseClips(content);
}

/** Model ids an OpenAI-compatible API offers for this key (GET /models). */
export async function listOpenAiModels(apiBase: string, apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${apiBase.replace(/\/+$/, "")}/models`, { headers: { Authorization: `Bearer ${apiKey}` }, signal });
  if (!res.ok) throw new Error(res.status === 401 ? "The API key was rejected." : `The API returned ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).sort();
}

const anthropicHeaders = (apiKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  "x-api-key": apiKey,
  "anthropic-version": ANTHROPIC_VERSION,
  // The key is the user's own and lives in their browser; Anthropic requires this opt-in for browser calls.
  "anthropic-dangerous-direct-browser-access": "true",
});

/** Request body for the Anthropic Messages API: the clips schema is a forced tool call, so the answer is always structured. */
export function anthropicRequestBody(model: string, system: string, user: string): Record<string, unknown> {
  return {
    model,
    max_tokens: 4096,
    temperature: 0.2,
    system,
    messages: [{ role: "user", content: user }],
    tools: [{ name: "clips", description: "Report the chosen clips.", input_schema: AI_CLIPS_SCHEMA }],
    tool_choice: { type: "tool", name: "clips" },
  };
}

/** Pulls the clips out of a Messages API reply (tool_use input first, then any JSON text). */
export function parseAnthropicClips(data: { content?: { type: string; input?: unknown; text?: string }[] }): AiClip[] {
  const tool = data.content?.find((c) => c.type === "tool_use");
  if (tool && tool.input && typeof tool.input === "object") return ((tool.input as { clips?: AiClip[] }).clips ?? []) as AiClip[];
  const text = data.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n") ?? "";
  return parseClips(text);
}

/** Sends the transcript to Anthropic with the user's own key. The transcript (not the video) leaves the device. */
async function findViaAnthropic(system: string, user: string, opts: FindAiOptions): Promise<AiClip[]> {
  const { anthropicKey, anthropicModel } = opts.settings;
  if (!anthropicKey) throw new Error("Add your Anthropic API key in the Model section first.");
  opts.onProgress?.(`Sending the transcript to ${anthropicModel} at api.anthropic.com`);
  let res: Response;
  try {
    res = await fetch(`${ANTHROPIC_API}/messages`, { method: "POST", headers: anthropicHeaders(anthropicKey), signal: opts.signal, body: JSON.stringify(anthropicRequestBody(anthropicModel, system, user)) });
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error("Couldn't reach api.anthropic.com. Check your connection.", { cause: e });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = "";
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
    if (res.status === 401) throw new Error("Anthropic rejected the API key (401). Check it in the Model section.");
    if (res.status === 403) throw new Error(`Anthropic refused the request (403)${detail ? `: ${detail}` : ""}`);
    if (res.status === 404) throw new Error(`The model "${anthropicModel}" wasn't found (404). Pick one from the list.`);
    if (res.status === 429) throw new Error("Anthropic is rate-limiting or out of credit (429). Try again in a minute.");
    throw new Error(`Anthropic returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  opts.onProgress?.(`${anthropicModel} is choosing clips`);
  return parseAnthropicClips((await res.json()) as { content?: { type: string; input?: unknown; text?: string }[] });
}

/** Claude model ids this key can use (GET /v1/models). */
export async function listAnthropicModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${ANTHROPIC_API}/models?limit=100`, { headers: anthropicHeaders(apiKey), signal });
  if (!res.ok) throw new Error(res.status === 401 ? "Anthropic rejected the API key." : `Anthropic returned ${res.status}`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

/** Gemini's response schema is an OpenAPI subset with upper-case types and no `additionalProperties`. */
export function toGeminiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (k === "additionalProperties") continue;
    out[k] = k === "type" && typeof v === "string" ? v.toUpperCase() : toGeminiSchema(v);
  }
  return out;
}

/** Request body for Gemini generateContent, asking for JSON that matches the clips schema. */
export function geminiRequestBody(system: string, user: string): Record<string, unknown> {
  return {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: "application/json", responseSchema: toGeminiSchema(AI_CLIPS_SCHEMA) },
  };
}

/** Pulls the clips out of a generateContent reply. */
export function parseGeminiClips(data: { candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]; promptFeedback?: { blockReason?: string } }): AiClip[] {
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini declined the transcript (${data.promptFeedback.blockReason}).`);
  const cand = data.candidates?.[0];
  const text = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  if (!text && cand?.finishReason && cand.finishReason !== "STOP") throw new Error(`Gemini stopped early (${cand.finishReason}). Try again or pick another model.`);
  return parseClips(text);
}

/** Sends the transcript to Google's Gemini API with the user's own key. The transcript (not the video) leaves the device. */
async function findViaGemini(system: string, user: string, opts: FindAiOptions): Promise<AiClip[]> {
  const { geminiKey, geminiModel } = opts.settings;
  if (!geminiKey) throw new Error("Add your Google AI Studio API key in the Model section first.");
  opts.onProgress?.(`Sending the transcript to ${geminiModel} at generativelanguage.googleapis.com`);
  let res: Response;
  try {
    res = await fetch(`${GEMINI_API}/models/${encodeURIComponent(geminiModel)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      signal: opts.signal,
      body: JSON.stringify(geminiRequestBody(system, user)),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error("Couldn't reach generativelanguage.googleapis.com. Check your connection.", { cause: e });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let detail = "";
    try {
      detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
    if (res.status === 400 && /api key/i.test(detail)) throw new Error("Google rejected the API key. Check it in the Model section.");
    if (res.status === 401 || res.status === 403) throw new Error(`Google refused the request (${res.status})${detail ? `: ${detail}` : ""}`);
    if (res.status === 404) throw new Error(`The model "${geminiModel}" wasn't found (404). Pick one from the list.`);
    if (res.status === 429) throw new Error("Gemini is rate-limiting or out of quota (429). Try again in a minute.");
    throw new Error(`Gemini returned ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  opts.onProgress?.(`${geminiModel} is choosing clips`);
  return parseGeminiClips((await res.json()) as Parameters<typeof parseGeminiClips>[0]);
}

/** Gemini model ids this key can use for generateContent (GET /v1beta/models). */
export async function listGeminiModels(apiKey: string, signal?: AbortSignal): Promise<string[]> {
  const res = await fetch(`${GEMINI_API}/models?pageSize=200`, { headers: { "x-goog-api-key": apiKey }, signal });
  if (!res.ok) throw new Error(res.status === 400 || res.status === 403 ? "Google rejected the API key." : `Google returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] };
  return (data.models ?? [])
    .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((id) => /^gemini/.test(id))
    .sort();
}

/** Asks the chosen model for the best moments of the transcript. Throws readable errors. */
export async function findAiHighlights(cues: CaptionCue[], opts: FindAiOptions): Promise<Highlight[]> {
  const sentences = sentencesFromCues(cues);
  if (sentences.length < 3) throw new Error(cues.length ? "The transcript is too short to cut reels from: it needs at least three sentences of speech." : "There isn't enough speech in the captions yet. Generate captions first.");
  const { system, user } = buildAiPrompt(sentences, opts);
  const promptTokens = estimateTokens(system + user);
  if (promptTokens > MAX_PROMPT_TOKENS) {
    throw new Error(`This transcript is too long for one pass (about ${Math.round(promptTokens / 1000)}k tokens). Trim the video to under about an hour and try again.`);
  }
  if (opts.settings.provider === "openai") return clipsToHighlights(await findViaOpenAi(system, user, opts), sentences, opts);
  if (opts.settings.provider === "anthropic") return clipsToHighlights(await findViaAnthropic(system, user, opts), sentences, opts);
  if (opts.settings.provider === "gemini") return clipsToHighlights(await findViaGemini(system, user, opts), sentences, opts);
  const endpoint = opts.settings.endpoint.replace(/\/+$/, "");
  const model = opts.settings.model;
  opts.onProgress?.(`Sending the transcript to ${model}`);

  let res: Response;
  try {
    res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: opts.signal,
      body: JSON.stringify({
        model,
        stream: true,
        think: false,
        format: AI_CLIPS_SCHEMA,
        options: { temperature: 0.2, num_ctx: contextFor(promptTokens) },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error(`Couldn't reach Ollama at ${endpoint}. Is it running? Start it with "ollama serve" or open the Ollama app.`, { cause: e });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 404 && /not found/i.test(text)) throw new Error(`The model "${model}" isn't installed. Run: ollama pull ${model}`);
    throw new Error(`Ollama returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }

  let content = "";
  let chunks = 0;
  const reader = res.body?.getReader();
  if (!reader) throw new Error("Ollama sent an empty response.");
  const decoder = new TextDecoder();
  let buffer = "";
  opts.onProgress?.(`${model} is reading the transcript`);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line) as { message?: { content?: string }; error?: string; done?: boolean };
        if (msg.error) throw new Error(`Ollama: ${msg.error}`);
        if (msg.message?.content) {
          content += msg.message.content;
          chunks++;
          if (chunks % 20 === 0) opts.onProgress?.(`${model} is choosing clips (${chunks} tokens written)`);
        }
      }
    }
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw e;
  }

  return clipsToHighlights(parseClips(content), sentences, opts);
}

/** Names of the models Ollama has installed (GET /api/tags); throws when the server is unreachable. */
export async function listOllamaModels(endpoint: string, signal?: AbortSignal): Promise<string[]> {
  const base = endpoint.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/tags`, { signal });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}`);
  const data = (await res.json()) as { models?: { name: string }[] };
  return (data.models ?? []).map((m) => m.name).sort();
}
