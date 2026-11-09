import { DEEPSEEK_API } from "@/lib/edit/aiHighlights";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export const CHAT_SYSTEM_PROMPT: string =
  "You are the assistant inside NoCap Edit, a video editor that runs in the browser. Help with editing, captions, hooks, titles and posting ideas. Answer briefly and plainly. The video itself is not visible to you.";

export function trimHistory(messages: ChatMessage[], maxChars: number): ChatMessage[] {
  const nonSystem = messages.filter((m) => m.role !== "system");
  if (nonSystem.length === 0) return [];
  const out: ChatMessage[] = [];
  let total = 0;
  for (let i = nonSystem.length - 1; i >= 0; i--) {
    const m = nonSystem[i];
    if (out.length > 0 && total + m.content.length > maxChars) break;
    out.unshift(m);
    total += m.content.length;
  }
  return out;
}

export function buildChatBody(model: string, messages: ChatMessage[]): string {
  return JSON.stringify({
    model,
    stream: true,
    messages: [{ role: "system", content: CHAT_SYSTEM_PROMPT }, ...trimHistory(messages, 24000)],
  });
}

export function parseSseChunk(buffer: string): { deltas: string[]; rest: string; done: boolean } {
  const deltas: string[] = [];
  let done = false;
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data.startsWith(":") || data === ": keep-alive") continue;
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const parsed = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
      const content = parsed.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content.length > 0) deltas.push(content);
    } catch {
      /* ignore lines that do not parse */
    }
  }
  return { deltas, rest, done };
}

export function chatErrorMessage(status: number, body: string): string {
  if (status === 401) return "DeepSeek rejected the API key. Check it and try again.";
  if (status === 402) return "DeepSeek says the account balance is empty.";
  if (status === 429) return "DeepSeek is busy or rate limiting. Wait a moment and try again.";
  if (status === 500 || status === 502 || status === 503 || status === 504) return "DeepSeek had a problem on its side. Try again in a moment.";
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (typeof parsed.error?.message === "string") detail = parsed.error.message.trim().slice(0, 200);
  } catch {
    /* body is not JSON */
  }
  return `DeepSeek returned ${status}.${detail ? ` ${detail}` : ""}`;
}

export async function streamDeepseekChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (text: string) => void;
}): Promise<string> {
  const res = await fetch(`${DEEPSEEK_API}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    signal: opts.signal,
    body: buildChatBody(opts.model, opts.messages),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(chatErrorMessage(res.status, text));
  }
  if (!res.body) throw new Error("DeepSeek sent no reply.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let done = false;
  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.rest;
    for (const delta of parsed.deltas) {
      full += delta;
      opts.onDelta(delta);
    }
    if (parsed.done) {
      done = true;
      break;
    }
  }
  if (!done && buffer) {
    const parsed = parseSseChunk(buffer + "\n");
    for (const delta of parsed.deltas) {
      full += delta;
      opts.onDelta(delta);
    }
  }
  if (!full) throw new Error("DeepSeek sent an empty reply.");
  return full;
}
