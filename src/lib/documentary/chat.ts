/**
 * "Ask about this moment": a chat beside the finished documentary. Every question goes to
 * DeepSeek (the visitor's own key, kept in this browser) together with the whole script, the
 * original transcript and where the viewer is in the film right now, so "what does this mean?"
 * is answered about the scene on screen. Only text is sent; the film never leaves the device.
 */
import { DEEPSEEK_API } from "@/lib/edit/aiHighlights";
import type { DocScript } from "./script";
import { sceneAt, type FilmTimeline } from "./timeline";
import { formatClock } from "./transcript";

export interface DocChatMessage {
  role: "user" | "assistant";
  content: string;
  /** For a question: where in the film it was asked, in seconds, and whether the film was paused. */
  paused?: boolean;
  at?: number;
}

export const MAX_CHAT_TRANSCRIPT_CHARS = 24000;
const MAX_HISTORY_CHARS = 16000;

/** Everything the model needs to know about the film; the same for every question about it. */
export function filmBrief(script: DocScript, tl: FilmTimeline, transcriptText: string): string {
  const scenes = script.scenes
    .map((s, i) => {
      const timing = tl.scenes[i];
      const range = timing ? `${formatClock(timing.start)}-${formatClock(timing.end)}` : "";
      const onScreen = [s.heading, ...s.lines].filter(Boolean).join(" | ");
      return `Scene ${i + 1} [${range}] (${s.kind})\nOn screen: ${onScreen}\nNarration: ${s.narration}`;
    })
    .join("\n\n");
  let source = transcriptText;
  if (source.length > MAX_CHAT_TRANSCRIPT_CHARS) {
    const head = Math.round(MAX_CHAT_TRANSCRIPT_CHARS * 0.6);
    source = `${source.slice(0, head)}\n\n[... middle left out ...]\n\n${source.slice(source.length - (MAX_CHAT_TRANSCRIPT_CHARS - head))}`;
  }
  return [
    `You are the study companion beside a short documentary called "${script.title}". The viewer is watching it and pauses to ask you questions.`,
    "Each question starts with a note in square brackets saying where in the film the viewer is. Unless they say otherwise, \"this\" means what that scene is showing and saying at that moment.",
    "Answer plainly and briefly (a few sentences), like a patient tutor. Give a concrete example when asked for one. Use the documentary and the source transcript below first; you may add general knowledge to explain a term, and say so when something is not from the video. No markdown headings or tables.",
    `THE DOCUMENTARY, SCENE BY SCENE:\n${scenes}`,
    `THE ORIGINAL VIDEO'S TRANSCRIPT (the documentary was made from it):\n${source}`,
  ].join("\n\n");
}

/** The bracketed note put in front of a question: the time, the scene, and whether the film was paused. */
export function momentNote(script: DocScript, tl: FilmTimeline, t: number, paused: boolean): string {
  const timing = sceneAt(tl, t);
  const scene = script.scenes[timing.index];
  const heading = scene.heading || scene.lines[0] || scene.kind;
  return `[${paused ? "Paused" : "Watching"} at ${formatClock(t)} of ${formatClock(tl.total)}, scene ${timing.index + 1} of ${script.scenes.length}: "${heading}"]`;
}

/** The heading of the scene on screen at `t`, for the "asking about" line above the box. */
export function sceneLabel(script: DocScript, tl: FilmTimeline, t: number): string {
  const scene = script.scenes[sceneAt(tl, t).index];
  return scene.heading || scene.lines[0] || scene.kind;
}

/** The newest messages that fit in `maxChars`, always including the last one. */
export function trimChat<T extends { content: string }>(messages: T[], maxChars = MAX_HISTORY_CHARS): T[] {
  const out: T[] = [];
  let total = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (out.length > 0 && total + messages[i].content.length > maxChars) break;
    out.unshift(messages[i]);
    total += messages[i].content.length;
  }
  return out;
}

/** The request body: the film brief, then the conversation with each question carrying its moment. */
export function chatBody(model: string, brief: string, messages: DocChatMessage[], note: (m: DocChatMessage) => string): Record<string, unknown> {
  const sent = trimChat(messages).map((m) => ({ role: m.role, content: m.role === "user" ? `${note(m)} ${m.content}` : m.content }));
  return { model, stream: true, temperature: 0.4, messages: [{ role: "system", content: brief }, ...sent] };
}

/** Pulls the text pieces out of a server-sent-events buffer; `rest` is the unfinished last line. */
export function parseSse(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  const deltas: string[] = [];
  let done = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const content = (JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) deltas.push(content);
    } catch {
      /* a keep-alive or a line that isn't JSON */
    }
  }
  return { deltas, rest, done };
}

export function chatError(status: number): string {
  if (status === 401) return "DeepSeek rejected the API key. Check it and try again.";
  if (status === 402) return "DeepSeek says the account balance is empty.";
  if (status === 429) return "DeepSeek is busy. Wait a moment and try again.";
  if (status >= 500) return "DeepSeek had a problem on its side. Try again in a moment.";
  return `DeepSeek answered ${status}. Try again.`;
}

/** Sends the conversation and calls `onDelta` as the answer is written; resolves with the whole answer. */
export async function askAboutFilm(opts: { apiKey: string; body: Record<string, unknown>; signal?: AbortSignal; onDelta: (text: string) => void }): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${DEEPSEEK_API}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      signal: opts.signal,
      body: JSON.stringify(opts.body),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    throw new Error("Couldn't reach DeepSeek. Check your connection.", { cause: e });
  }
  if (!res.ok) throw new Error(chatError(res.status));
  if (!res.body) throw new Error("DeepSeek sent no reply.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const d of parsed.deltas) {
      full += d;
      opts.onDelta(d);
    }
    if (parsed.done) break;
  }
  for (const d of parseSse(`${buffer}\n`).deltas) {
    full += d;
    opts.onDelta(d);
  }
  if (!full) throw new Error("DeepSeek sent an empty reply.");
  return full;
}
