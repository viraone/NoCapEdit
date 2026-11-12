import { afterEach, describe, expect, it, vi } from "vitest";
import { parseAgentSse, mergeToolDeltas, buildAgentBody, streamAgentTurn, runAgent } from "@/lib/chat/deepseekAgent";
import type { AgentAction, ApiMessage, ToolCall, ToolDef } from "@/lib/chat/toolTypes";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseAgentSse", () => {
  it("extracts text deltas", () => {
    const input = 'data: {"choices":[{"delta":{"content":"Hello"}}]}\ndata: {"choices":[{"delta":{"content":" world"}}]}\n\n';
    const res = parseAgentSse(input);
    expect(res.text).toEqual(["Hello", " world"]);
    expect(res.tools).toEqual([]);
    expect(res.rest).toBe("");
    expect(res.done).toBe(false);
  });

  it("extracts a tool_calls delta with id, name and partial args", () => {
    const input = 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"edit","arguments":"{\\"x\\":1}"}}]}}]}\n\n';
    const res = parseAgentSse(input);
    expect(res.tools).toEqual([{ index: 0, id: "call_1", name: "edit", args: '{"x":1}' }]);
    expect(res.text).toEqual([]);
  });

  it("holds a split line in rest", () => {
    const input = 'data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"cho';
    const res = parseAgentSse(input);
    expect(res.text).toEqual(["a"]);
    expect(res.rest).toBe('data: {"cho');
    expect(res.done).toBe(false);
  });

  it("handles [DONE]", () => {
    const res = parseAgentSse('data: {"choices":[{"delta":{"content":"a"}}]}\ndata: [DONE]\n\n');
    expect(res.text).toEqual(["a"]);
    expect(res.done).toBe(true);
  });

  it("skips bad JSON lines", () => {
    const res = parseAgentSse('data: not-json\ndata: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    expect(res.text).toEqual(["ok"]);
  });
});

describe("mergeToolDeltas", () => {
  it("merges arguments split over three deltas into valid JSON", () => {
    const deltas = [
      { index: 0, id: "call_1", name: "edit", args: '{"x":' },
      { index: 0, args: "1," },
      { index: 0, args: '"y":2}' },
    ];
    const merged = mergeToolDeltas([], deltas);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("call_1");
    expect(merged[0].name).toBe("edit");
    expect(JSON.parse(merged[0].arguments)).toEqual({ x: 1, y: 2 });
  });

  it("handles two calls with indexes 0 and 1", () => {
    const deltas = [
      { index: 0, id: "a", name: "toolA", args: "{}" },
      { index: 1, id: "b", name: "toolB", args: "{}" },
    ];
    const merged = mergeToolDeltas([], deltas);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual({ id: "a", name: "toolA", arguments: "{}" });
    expect(merged[1]).toEqual({ id: "b", name: "toolB", arguments: "{}" });
  });

  it("does not mutate the input array", () => {
    const calls: ToolCall[] = [{ id: "a", name: "toolA", arguments: "{}" }];
    const deltas = [{ index: 0, args: "x" }];
    const merged = mergeToolDeltas(calls, deltas);
    expect(calls[0].arguments).toBe("{}");
    expect(merged[0].arguments).toBe("{}x");
    expect(merged).not.toBe(calls);
  });
});

describe("buildAgentBody", () => {
  it("puts system first and omits tools when not provided", () => {
    const body = JSON.parse(buildAgentBody("model", "sys", [{ role: "user", content: "hi" }])) as Record<string, unknown>;
    expect(body.model).toBe("model");
    expect(body.stream).toBe(true);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
    ]);
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("includes tools and tool_choice only when tools non-empty", () => {
    const tools: ToolDef[] = [{ type: "function", function: { name: "edit", description: "d", parameters: {} } }];
    const body = JSON.parse(buildAgentBody("model", "sys", [], tools)) as Record<string, unknown>;
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toBe("auto");
  });
});

describe("streamAgentTurn", () => {
  function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
  }

  it("returns a text-only reply", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n',
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sseStream(chunks), { status: 200 })));
    const onText = vi.fn();
    const res = await streamAgentTurn({
      apiKey: "k",
      model: "m",
      system: "s",
      messages: [],
      onText,
    });
    expect(res.content).toBe("Hello");
    expect(res.toolCalls).toEqual([]);
    expect(onText).toHaveBeenCalledWith("Hel");
    expect(onText).toHaveBeenCalledWith("lo");
  });

  it("returns a tool call split over chunks", async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"edit","arguments":"{\\"x\\":"}}]}}]}\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"1}"}}]}}]}\n',
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sseStream(chunks), { status: 200 })));
    const res = await streamAgentTurn({ apiKey: "k", model: "m", system: "s", messages: [], onText: () => {} });
    expect(res.content).toBe("");
    expect(res.toolCalls).toHaveLength(1);
    expect(res.toolCalls[0]).toEqual({ id: "call_1", name: "edit", arguments: '{"x":1}' });
  });

  it("throws the 401 message on a 401 JSON error response", async () => {
    const body = JSON.stringify({ error: { message: "bad key" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 401 })));
    await expect(
      streamAgentTurn({ apiKey: "k", model: "m", system: "s", messages: [], onText: () => {} })
    ).rejects.toThrow("DeepSeek rejected the API key. Check it and try again.");
  });
});

describe("runAgent", () => {
  it("runs a tool round then a text round", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "Let me edit.",
        toolCalls: [{ id: "call_1", name: "edit", arguments: '{"x":1}' }],
      })
      .mockResolvedValueOnce({ content: "Done.", toolCalls: [] });
    const runTool = vi.fn().mockResolvedValue({ ok: true, message: "edited", label: "Edited clip" });
    const onAction = vi.fn();
    const res = await runAgent({
      history: [{ role: "user", content: "hi" }],
      callModel,
      runTool,
      onAction,
    });
    expect(res.text).toBe("Let me edit.\n\nDone.");
    expect(res.hitLimit).toBe(false);
    expect(runTool).toHaveBeenCalledWith("edit", { x: 1 });
    expect(onAction).toHaveBeenCalledWith({ label: "Edited clip", ok: true });
    expect(callModel).toHaveBeenCalledTimes(2);
    const secondMessages = callModel.mock.calls[1][0] as ApiMessage[];
    expect(secondMessages[secondMessages.length - 2]).toEqual({
      role: "assistant",
      content: "Let me edit.",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "edit", arguments: '{"x":1}' } }],
    });
    expect(secondMessages[secondMessages.length - 1]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ ok: true, message: "edited" }),
    });
  });

  it("does not call runTool for invalid JSON arguments", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "call_1", name: "edit", arguments: "not-json" }],
      })
      .mockResolvedValueOnce({ content: "ok", toolCalls: [] });
    const runTool = vi.fn();
    const actions: AgentAction[] = [];
    const res = await runAgent({
      history: [],
      callModel,
      runTool,
      onAction: (a) => actions.push(a),
    });
    expect(runTool).not.toHaveBeenCalled();
    expect(actions).toEqual([{ label: "The arguments were not valid JSON.", ok: false }]);
    expect(res.text).toBe("ok");
  });

  it("continues when runTool throws", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [{ id: "call_1", name: "edit", arguments: "{}" }],
      })
      .mockResolvedValueOnce({ content: "recovered", toolCalls: [] });
    const runTool = vi.fn().mockRejectedValue(new Error("boom"));
    const actions: AgentAction[] = [];
    const res = await runAgent({
      history: [],
      callModel,
      runTool,
      onAction: (a) => actions.push(a),
    });
    expect(actions).toEqual([{ label: "boom", ok: false }]);
    expect(res.text).toBe("recovered");
    expect(res.hitLimit).toBe(false);
  });

  it("runs only the first tool call of a step when oneToolPerStep is on", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({
        content: "",
        toolCalls: [
          { id: "call_1", name: "transcribe", arguments: "{}" },
          { id: "call_2", name: "cut_ranges", arguments: '{"ranges":[{"start":0,"end":9}]}' },
          { id: "call_3", name: "cut_ranges", arguments: '{"ranges":[{"start":0,"end":9}]}' },
        ],
      })
      .mockResolvedValueOnce({ content: "read the transcript", toolCalls: [] });
    const runTool = vi.fn().mockResolvedValue({ ok: true, message: "ok", label: "Transcribed" });
    const actions: AgentAction[] = [];
    const res = await runAgent({ history: [], callModel, runTool, oneToolPerStep: true, onAction: (a) => actions.push(a) });
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool).toHaveBeenCalledWith("transcribe", {});
    expect(actions).toEqual([{ label: "Transcribed", ok: true }]);
    const second = callModel.mock.calls[1][0] as ApiMessage[];
    const toolMessages = second.filter((m) => m.role === "tool");
    expect(toolMessages.map((m) => (m as { tool_call_id: string }).tool_call_id)).toEqual(["call_1", "call_2", "call_3"]);
    expect(JSON.parse((toolMessages[1] as { content: string }).content)).toMatchObject({ ok: false });
    expect(res.text).toBe("read the transcript");
  });

  it("runs every tool call of a step when oneToolPerStep is off", async () => {
    const callModel = vi
      .fn()
      .mockResolvedValueOnce({ content: "", toolCalls: [{ id: "a", name: "x", arguments: "{}" }, { id: "b", name: "y", arguments: "{}" }] })
      .mockResolvedValueOnce({ content: "done", toolCalls: [] });
    const runTool = vi.fn().mockResolvedValue({ ok: true, message: "ok" });
    await runAgent({ history: [], callModel, runTool });
    expect(runTool).toHaveBeenCalledTimes(2);
  });

  it("hits the limit when the model always asks for tools", async () => {
    const callModel = vi.fn().mockResolvedValue({
      content: "",
      toolCalls: [{ id: "call_1", name: "edit", arguments: "{}" }],
    });
    const runTool = vi.fn().mockResolvedValue({ ok: true, message: "ok" });
    const res = await runAgent({
      history: [],
      callModel,
      runTool,
      maxRounds: 2,
    });
    expect(res.hitLimit).toBe(true);
    expect(callModel).toHaveBeenCalledTimes(2);
  });

  it("rejects with an AbortError when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runAgent({
        history: [],
        callModel: vi.fn(),
        runTool: vi.fn(),
        signal: controller.signal,
      })
    ).rejects.toThrow("Aborted");
  });
});

