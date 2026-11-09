import { describe, expect, it } from "vitest";
import {
  CHAT_SYSTEM_PROMPT,
  buildChatBody,
  chatErrorMessage,
  parseSseChunk,
  trimHistory,
  type ChatMessage,
} from "@/lib/chat/deepseekChat";

describe("trimHistory", () => {
  it("keeps the newest messages within the limit", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "a".repeat(100) },
      { role: "assistant", content: "b".repeat(100) },
      { role: "user", content: "c".repeat(100) },
    ];
    const out = trimHistory(messages, 250);
    expect(out).toEqual([messages[1], messages[2]]);
  });

  it("keeps the last message even when it alone exceeds the limit", () => {
    const messages: ChatMessage[] = [
      { role: "user", content: "short" },
      { role: "assistant", content: "x".repeat(500) },
    ];
    const out = trimHistory(messages, 100);
    expect(out).toEqual([messages[1]]);
  });

  it("drops system messages", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "hello" },
    ];
    const out = trimHistory(messages, 1000);
    expect(out).toEqual([messages[1]]);
  });
});

describe("buildChatBody", () => {
  it("builds a stream body with the system prompt first", () => {
    const body = JSON.parse(buildChatBody("deepseek-chat", [{ role: "user", content: "hi" }])) as {
      model: string;
      stream: boolean;
      messages: ChatMessage[];
    };
    expect(body.model).toBe("deepseek-chat");
    expect(body.stream).toBe(true);
    expect(body.messages[0]).toEqual({ role: "system", content: CHAT_SYSTEM_PROMPT });
    expect(body.messages[1]).toEqual({ role: "user", content: "hi" });
  });
});

describe("parseSseChunk", () => {
  it("parses two data lines into two deltas", () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\ndata: {"choices":[{"delta":{"content":" world"}}]}\n';
    const { deltas, rest, done } = parseSseChunk(chunk);
    expect(deltas).toEqual(["Hello", " world"]);
    expect(rest).toBe("");
    expect(done).toBe(false);
  });

  it("holds a split line in rest until the next call", () => {
    const first = parseSseChunk('data: {"choices":[{"delta":{"content":"Hel');
    expect(first.deltas).toEqual([]);
    expect(first.rest).toBe('data: {"choices":[{"delta":{"content":"Hel');
    const second = parseSseChunk(first.rest + 'lo"}}]}\n');
    expect(second.deltas).toEqual(["Hello"]);
    expect(second.rest).toBe("");
  });

  it("sets done on [DONE]", () => {
    const { done } = parseSseChunk('data: {"choices":[{"delta":{"content":"x"}}]}\ndata: [DONE]\n');
    expect(done).toBe(true);
  });

  it("ignores reasoning_content, keep-alive and blank lines", () => {
    const chunk =
      'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}\n' +
      ': keep-alive\n' +
      "\n" +
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n';
    const { deltas } = parseSseChunk(chunk);
    expect(deltas).toEqual(["ok"]);
  });

  it("skips a bad JSON line", () => {
    const chunk = 'data: not-json\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n';
    const { deltas } = parseSseChunk(chunk);
    expect(deltas).toEqual(["ok"]);
  });
});

describe("chatErrorMessage", () => {
  it("handles 401", () => {
    expect(chatErrorMessage(401, "")).toBe("DeepSeek rejected the API key. Check it and try again.");
  });

  it("handles 402", () => {
    expect(chatErrorMessage(402, "")).toBe("DeepSeek says the account balance is empty.");
  });

  it("handles 429", () => {
    expect(chatErrorMessage(429, "")).toBe("DeepSeek is busy or rate limiting. Wait a moment and try again.");
  });

  it("handles 503", () => {
    expect(chatErrorMessage(503, "")).toBe("DeepSeek had a problem on its side. Try again in a moment.");
  });

  it("handles 400 without a JSON error message", () => {
    expect(chatErrorMessage(400, "plain text")).toBe("DeepSeek returned 400.");
  });

  it("handles 400 with a JSON error message", () => {
    expect(chatErrorMessage(400, JSON.stringify({ error: { message: "Bad request" } }))).toBe("DeepSeek returned 400. Bad request");
  });
});
