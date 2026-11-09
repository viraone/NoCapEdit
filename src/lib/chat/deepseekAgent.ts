import { DEEPSEEK_API } from "@/lib/edit/aiHighlights";
import { chatErrorMessage } from "@/lib/chat/deepseekChat";
import type { AgentAction, ApiMessage, ToolCall, ToolDef, ToolResult } from "@/lib/chat/toolTypes";

export interface ToolDelta {
  index: number;
  id?: string;
  name?: string;
  args?: string;
}

export function parseAgentSse(buffer: string): { text: string[]; tools: ToolDelta[]; rest: string; done: boolean } {
  const text: string[] = [];
  const tools: ToolDelta[] = [];
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
      const parsed = JSON.parse(data) as {
        choices?: { delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[];
      };
      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === "string" && delta.content.length > 0) text.push(delta.content);
      if (Array.isArray(delta.tool_calls)) {
        for (const item of delta.tool_calls) {
          const td: ToolDelta = { index: item.index ?? 0 };
          if (typeof item.id === "string" && item.id.length > 0) td.id = item.id;
          if (typeof item.function?.name === "string" && item.function.name.length > 0) td.name = item.function.name;
          if (typeof item.function?.arguments === "string") td.args = item.function.arguments;
          tools.push(td);
        }
      }
    } catch {
      /* ignore lines that do not parse */
    }
  }
  return { text, tools, rest, done };
}

export function mergeToolDeltas(calls: ToolCall[], deltas: ToolDelta[]): ToolCall[] {
  const out: ToolCall[] = calls.map((c) => ({ ...c }));
  for (const delta of deltas) {
    while (out.length <= delta.index) out.push({ id: "", name: "", arguments: "" });
    const entry = out[delta.index];
    if (delta.id !== undefined) entry.id = delta.id;
    if (delta.name !== undefined && entry.name === "") entry.name = delta.name;
    if (delta.args !== undefined) entry.arguments += delta.args;
  }
  return out;
}

export function buildAgentBody(model: string, system: string, messages: ApiMessage[], tools?: ToolDef[]): string {
  const body: Record<string, unknown> = {
    model,
    stream: true,
    messages: [{ role: "system", content: system }, ...messages],
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  return JSON.stringify(body);
}

export async function streamAgentTurn(opts: {
  apiKey: string;
  model: string;
  system: string;
  messages: ApiMessage[];
  tools?: ToolDef[];
  signal?: AbortSignal;
  onText: (t: string) => void;
}): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await fetch(`${DEEPSEEK_API}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
    signal: opts.signal,
    body: buildAgentBody(opts.model, opts.system, opts.messages, opts.tools),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(chatErrorMessage(res.status, text));
  }
  if (!res.body) throw new Error("DeepSeek sent no reply.");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let toolCalls: ToolCall[] = [];
  let done = false;
  for (;;) {
    const { value, done: streamDone } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseAgentSse(buffer);
    buffer = parsed.rest;
    for (const t of parsed.text) {
      content += t;
      opts.onText(t);
    }
    toolCalls = mergeToolDeltas(toolCalls, parsed.tools);
    if (parsed.done) {
      done = true;
      break;
    }
  }
  if (!done && buffer) {
    const parsed = parseAgentSse(buffer + "\n");
    for (const t of parsed.text) {
      content += t;
      opts.onText(t);
    }
    toolCalls = mergeToolDeltas(toolCalls, parsed.tools);
  }
  toolCalls = toolCalls.filter((c) => c.name !== "");
  if (!content && toolCalls.length === 0) throw new Error("DeepSeek sent an empty reply.");
  return { content, toolCalls };
}

export interface AgentRunOptions {
  history: ApiMessage[];
  callModel: (messages: ApiMessage[]) => Promise<{ content: string; toolCalls: ToolCall[] }>;
  runTool: (name: string, args: unknown) => Promise<ToolResult>;
  onRound?: (round: number) => void;
  onAction?: (a: AgentAction) => void;
  signal?: AbortSignal;
  maxRounds?: number;
}

export async function runAgent(o: AgentRunOptions): Promise<{ text: string; actions: AgentAction[]; hitLimit: boolean }> {
  const messages: ApiMessage[] = [...o.history];
  const contents: string[] = [];
  const actions: AgentAction[] = [];
  const maxRounds = o.maxRounds ?? 8;
  for (let round = 0; round < maxRounds; round++) {
    if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    o.onRound?.(round);
    const res = await o.callModel(messages);
    if (res.content.trim().length > 0) contents.push(res.content);
    if (res.toolCalls.length === 0) return { text: contents.join("\n\n"), actions, hitLimit: false };
    messages.push({
      role: "assistant",
      content: res.content,
      tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.arguments } })),
    });
    for (const c of res.toolCalls) {
      if (o.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      let args: unknown;
      let result: ToolResult;
      const trimmedArgs = c.arguments.trim();
      if (trimmedArgs === "") {
        args = {};
      } else {
        try {
          args = JSON.parse(c.arguments);
        } catch {
          result = { ok: false, message: "The arguments were not valid JSON." };
          const action: AgentAction = { label: result.message.slice(0, 120), ok: result.ok };
          actions.push(action);
          o.onAction?.(action);
          messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ ok: result.ok, message: result.message }) });
          continue;
        }
      }
      try {
        result = await o.runTool(c.name, args);
      } catch (err) {
        result = { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
      const action: AgentAction = { label: result.ok ? (result.label ?? c.name) : result.message.slice(0, 120), ok: result.ok };
      actions.push(action);
      o.onAction?.(action);
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ ok: result.ok, message: result.message }) });
    }
  }
  return { text: contents.join("\n\n"), actions, hitLimit: true };
}

