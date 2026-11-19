/**
 * Asks the visitor's chosen AI model (the one set in the site's AI settings, with their own
 * key kept in this browser) for a documentary script. The transcript text goes to that
 * provider; the video never does. Ollama runs on their own computer.
 */
import { ANTHROPIC_API, DEEPSEEK_API, GEMINI_API, XAI_API, activeModel, type AiSettings } from "@/lib/edit/aiHighlights";
import { buildScriptPrompt, parseScript, type DocScript } from "./script";
import { buildAnimationPrompt, parseAnimationScript } from "./animationScript";
import type { TranscriptCue } from "./transcript";

export interface ModelRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** Pulls the answer text out of the provider's JSON reply. */
  readText: (data: unknown) => string;
}

/** A plain sentence saying what is missing for this provider, or null when it can be called. */
export function aiMissing(s: AiSettings): string | null {
  const need = (key: string, who: string) => (key.trim() ? null : `Add your ${who} key in the AI settings first.`);
  switch (s.provider) {
    case "anthropic":
      return need(s.anthropicKey, "Anthropic (Claude)");
    case "openai":
      return need(s.apiKey, "API");
    case "gemini":
      return need(s.geminiKey, "Google AI Studio");
    case "xai":
      return need(s.xaiKey, "xAI");
    case "deepseek":
      return need(s.deepseekKey, "DeepSeek");
    default:
      return null;
  }
}

const openAiShape = (data: unknown): string => (data as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? "";

function openAiCompatible(base: string, key: string, model: string, system: string, user: string): ModelRequest {
  return {
    url: `${base.replace(/\/+$/, "")}/chat/completions`,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: { model, temperature: 0.5, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
    readText: openAiShape,
  };
}

/** The request for the provider in `s`, built without sending anything (so it can be tested). */
export function modelRequest(s: AiSettings, system: string, user: string): ModelRequest {
  const model = activeModel(s);
  switch (s.provider) {
    case "anthropic":
      return {
        url: `${ANTHROPIC_API}/messages`,
        headers: {
          "Content-Type": "application/json",
          "x-api-key": s.anthropicKey,
          "anthropic-version": "2023-06-01",
          // The key is the visitor's own and stays in their browser; Anthropic requires this opt-in for browser calls.
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: { model, max_tokens: 8192, temperature: 0.5, system, messages: [{ role: "user", content: user }] },
        readText: (d) => ((d as { content?: { type: string; text?: string }[] }).content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n"),
      };
    case "gemini":
      return {
        url: `${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`,
        headers: { "Content-Type": "application/json", "x-goog-api-key": s.geminiKey },
        body: {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: user }] }],
          generationConfig: { temperature: 0.5, maxOutputTokens: 16384, responseMimeType: "application/json" },
        },
        readText: (d) => ((d as { candidates?: { content?: { parts?: { text?: string }[] } }[] }).candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join(""),
      };
    case "openai":
      return openAiCompatible(s.apiBase, s.apiKey, model, system, user);
    case "xai":
      return openAiCompatible(XAI_API, s.xaiKey, model, system, user);
    case "deepseek":
      return openAiCompatible(DEEPSEEK_API, s.deepseekKey, model, system, user);
    default:
      return {
        url: `${s.endpoint.replace(/\/+$/, "")}/api/chat`,
        headers: { "Content-Type": "application/json" },
        body: { model, stream: false, think: false, options: { temperature: 0.5, num_ctx: 32768 }, messages: [{ role: "system", content: system }, { role: "user", content: user }] },
        readText: (d) => (d as { message?: { content?: string } }).message?.content ?? "",
      };
  }
}

async function ask(s: AiSettings, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const req = modelRequest(s, system, user);
  const where = new URL(req.url).host;
  let res: Response;
  try {
    res = await fetch(req.url, { method: "POST", headers: req.headers, body: JSON.stringify(req.body), signal });
  } catch (e) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error(s.provider === "ollama" ? "Couldn't reach Ollama on this computer. Is it running?" : `Couldn't reach ${where}. Check your connection.`, { cause: e });
  }
  if (res.status === 401 || res.status === 403) throw new Error("The API key was rejected. Check it in the AI settings.");
  if (res.status === 429) throw new Error("The AI service says too many requests. Wait a minute and try again.");
  if (!res.ok) throw new Error(`The AI service answered ${res.status}. Try again.`);
  return req.readText(await res.json());
}

export interface WriteScriptOptions {
  settings: AiSettings;
  minutes: number;
  language: string;
  /** "animation" also asks for a picture for every scene. Default: "documentary". */
  style?: "documentary" | "animation";
  signal?: AbortSignal;
}

/** Writes the documentary script for a transcript; asks once more if the first answer isn't a usable script. */
export async function writeDocumentaryScript(title: string, cues: TranscriptCue[], opts: WriteScriptOptions): Promise<DocScript> {
  const missing = aiMissing(opts.settings);
  if (missing) throw new Error(missing);
  const animation = opts.style === "animation";
  const { system, user } = (animation ? buildAnimationPrompt : buildScriptPrompt)(title, cues, { minutes: opts.minutes, language: opts.language });
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return (animation ? parseAnimationScript : parseScript)(await ask(opts.settings, system, user, opts.signal));
    } catch (e) {
      if (opts.signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
      lastError = e;
      // Only an unusable answer is worth asking again; a rejected key or a dead connection would just fail again.
      if (!(e instanceof Error) || !e.message.startsWith("The AI's")) throw e;
    }
  }
  throw lastError;
}
