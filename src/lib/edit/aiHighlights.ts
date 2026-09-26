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

export interface AiSettings {
  /** Ollama server, e.g. http://localhost:11434 */
  endpoint: string;
  /** Ollama model name, e.g. qwen3.8:27b */
  model: string;
}

export const DEFAULT_AI_SETTINGS: AiSettings = { endpoint: "http://localhost:11434", model: "qwen3.8:27b" };
const SETTINGS_KEY = "reelflow.ai";

export function loadAiSettings(): AiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<AiSettings>) : {};
    return {
      endpoint: typeof parsed.endpoint === "string" && parsed.endpoint.trim() ? parsed.endpoint.trim() : DEFAULT_AI_SETTINGS.endpoint,
      model: typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : DEFAULT_AI_SETTINGS.model,
    };
  } catch {
    return { ...DEFAULT_AI_SETTINGS };
  }
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

/** Asks the local model for the best moments of the transcript. Throws readable errors. */
export async function findAiHighlights(cues: CaptionCue[], opts: FindAiOptions): Promise<Highlight[]> {
  const sentences = sentencesFromCues(cues);
  if (sentences.length < 3) throw new Error("There isn't enough speech in the captions yet. Generate captions first.");
  const { system, user } = buildAiPrompt(sentences, opts);
  const promptTokens = estimateTokens(system + user);
  if (promptTokens > MAX_PROMPT_TOKENS) {
    throw new Error(`This transcript is too long for one pass (about ${Math.round(promptTokens / 1000)}k tokens). Trim the video to under about an hour and try again.`);
  }
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

  let clips: AiClip[];
  try {
    clips = (JSON.parse(content) as { clips?: AiClip[] }).clips ?? [];
  } catch {
    throw new Error("The model's answer wasn't valid JSON. Try again.");
  }
  return clipsToHighlights(clips, sentences, opts);
}
