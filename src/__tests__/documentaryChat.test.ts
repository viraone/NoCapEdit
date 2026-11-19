import { describe, expect, it } from "vitest";
import { chatBody, chatError, filmBrief, MAX_CHAT_TRANSCRIPT_CHARS, momentNote, parseSse, sceneLabel, trimChat, type DocChatMessage } from "@/lib/documentary/chat";
import type { DocScript } from "@/lib/documentary/script";
import { buildTimeline } from "@/lib/documentary/timeline";

const script: DocScript = {
  title: "Passing the Exam",
  scenes: [
    { id: "s1", kind: "title", heading: "Passing the Exam", lines: ["A guide"], narration: "Welcome to the film." },
    { id: "s2", kind: "point", heading: "Two exams", lines: ["Core 1", "Core 2"], narration: "There are two exams to pass." },
    { id: "s3", kind: "credits", heading: "", lines: [], narration: "Thanks." },
  ],
};
const tl = buildTimeline(script.scenes, [5, 10, 2]);

describe("filmBrief", () => {
  it("lists every scene with its time range, screen text and narration, then the transcript", () => {
    const brief = filmBrief(script, tl, "the original words");
    expect(brief).toContain('"Passing the Exam"');
    expect(brief).toContain("Scene 2 [0:06-0:18] (point)");
    expect(brief).toContain("On screen: Two exams | Core 1 | Core 2");
    expect(brief).toContain("Narration: There are two exams to pass.");
    expect(brief).toContain("the original words");
  });
  it("leaves out the middle of a very long transcript", () => {
    const brief = filmBrief(script, tl, "x".repeat(MAX_CHAT_TRANSCRIPT_CHARS * 2));
    expect(brief).toContain("[... middle left out ...]");
    expect(brief.length).toBeLessThan(MAX_CHAT_TRANSCRIPT_CHARS + 3000);
  });
});

describe("momentNote and sceneLabel", () => {
  it("says where the viewer is and whether the film is paused", () => {
    expect(momentNote(script, tl, 8, true)).toBe('[Paused at 0:08 of 0:22, scene 2 of 3: "Two exams"]');
    expect(momentNote(script, tl, 1, false)).toBe('[Watching at 0:01 of 0:22, scene 1 of 3: "Passing the Exam"]');
  });
  it("falls back to the scene kind when a scene has no heading or lines", () => {
    expect(sceneLabel(script, tl, 22)).toBe("credits");
    expect(sceneLabel(script, tl, 8)).toBe("Two exams");
  });
});

describe("trimChat and chatBody", () => {
  it("keeps the newest messages that fit, always the last one", () => {
    const msgs = [{ content: "a".repeat(10) }, { content: "b".repeat(10) }, { content: "c".repeat(10) }];
    expect(trimChat(msgs, 20)).toEqual(msgs.slice(1));
    expect(trimChat(msgs, 1)).toEqual(msgs.slice(2));
    expect(trimChat([], 10)).toEqual([]);
  });
  it("puts the brief first and the moment in front of each question only", () => {
    const messages: DocChatMessage[] = [{ role: "user", content: "What does this mean?", at: 8 }, { role: "assistant", content: "It means X." }];
    const body = chatBody("deepseek-chat", "BRIEF", messages, (m) => `[at ${m.at}]`);
    expect(body).toMatchObject({ model: "deepseek-chat", stream: true });
    expect(body.messages).toEqual([
      { role: "system", content: "BRIEF" },
      { role: "user", content: "[at 8] What does this mean?" },
      { role: "assistant", content: "It means X." },
    ]);
  });
});

describe("parseSse", () => {
  it("collects the text pieces and keeps the unfinished line", () => {
    const chunk = 'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n: keep-alive\ndata: {"choices":[{"delta":{"content":"lo"}}]}\ndata: {"cho';
    expect(parseSse(chunk)).toEqual({ deltas: ["Hel", "lo"], rest: 'data: {"cho', done: false });
  });
  it("sees the end marker", () => {
    expect(parseSse("data: [DONE]\n")).toEqual({ deltas: [], rest: "", done: true });
  });
});

describe("chatError", () => {
  it("explains the common failures in plain words", () => {
    expect(chatError(401)).toMatch(/rejected the API key/);
    expect(chatError(402)).toMatch(/balance/);
    expect(chatError(429)).toMatch(/busy/);
    expect(chatError(503)).toMatch(/its side/);
    expect(chatError(418)).toBe("DeepSeek answered 418. Try again.");
  });
});
