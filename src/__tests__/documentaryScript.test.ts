import { describe, expect, it } from "vitest";
import { buildScriptPrompt, MAX_TRANSCRIPT_CHARS, narrationWords, parseScript } from "@/lib/documentary/script";
import type { TranscriptCue } from "@/lib/documentary/transcript";

const scene = (narration: string, extra: object = {}) => ({ kind: "point", heading: "H", lines: [], narration, ...extra });

describe("parseScript", () => {
  it("reads a fenced answer, dropping silent scenes and unknown kinds", () => {
    const body = JSON.stringify({
      title: " My Film ",
      scenes: [scene(" Hello there. ", { kind: "title", heading: "Opening", lines: ["a", "", "b"] }), scene("One idea.", { kind: "weird" }), scene("  ")],
    });
    const script = parseScript(`Here you go:\n\`\`\`json\n${body}\n\`\`\``);
    expect(script.title).toBe("My Film");
    expect(script.scenes.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(script.scenes.map((s) => s.kind)).toEqual(["title", "point"]);
    expect(script.scenes[0].lines).toEqual(["a", "b"]);
    expect(script.scenes[0].narration).toBe("Hello there.");
  });

  it("keeps at most four lines of 120 characters", () => {
    const script = parseScript(JSON.stringify({ title: "T", scenes: [scene("n", { lines: ["a", "b", "c", "x".repeat(200), "e", "f"] }), scene("n2")] }));
    expect(script.scenes[0].lines).toHaveLength(4);
    expect(script.scenes[0].lines[3]).toBe("x".repeat(120));
  });

  it("explains a bad answer in plain words", () => {
    expect(() => parseScript("no json here")).toThrow("The AI's answer wasn't a script. Try again.");
    expect(() => parseScript("{ broken")).toThrow("The AI's answer wasn't a script. Try again.");
    expect(() => parseScript(JSON.stringify({ title: "T", scenes: [scene("only one"), scene("  ")] }))).toThrow("The AI's script was too short. Try again.");
  });
});

describe("buildScriptPrompt", () => {
  it("puts the title, the length target and the transcript in the prompt", () => {
    const cues: TranscriptCue[] = [{ start: 0, end: 1, text: "Hello" }, { start: 1, end: 2, text: "world" }];
    const { user, system } = buildScriptPrompt("My Video", cues, { minutes: 2, language: "English" });
    expect(user).toContain("My Video");
    expect(user).toContain("about 280 words");
    expect(user).toContain("Hello world");
    expect(system).toContain("JSON");
    expect(system).toContain("credits");
  });

  it("leaves out the middle of a very long transcript", () => {
    const cues: TranscriptCue[] = Array.from({ length: 1000 }, (_, i) => ({ start: i, end: i + 1, text: "x".repeat(100) }));
    const { user } = buildScriptPrompt("T", cues, { minutes: 2, language: "English" });
    expect(user).toContain("[... middle of the transcript left out ...]");
    expect(user.length).toBeLessThan(MAX_TRANSCRIPT_CHARS + 400);
  });
});

describe("narrationWords", () => {
  it("counts the words across scenes", () => {
    const s = { title: "T", scenes: [{ id: "s1", kind: "point" as const, heading: "", lines: [], narration: "one two three" }, { id: "s2", kind: "point" as const, heading: "", lines: [], narration: "four five" }] };
    expect(narrationWords(s)).toBe(5);
  });
});
