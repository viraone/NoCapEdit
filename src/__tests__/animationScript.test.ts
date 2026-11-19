import { describe, expect, it } from "vitest";
import { buildAnimationPrompt, countUp, firstGlyph, parseAnimationScript, parseVisual } from "@/lib/documentary/animationScript";
import { buildScriptPrompt } from "@/lib/documentary/script";

describe("parseVisual", () => {
  it("keeps icons and the type", () => {
    expect(parseVisual({ visual: "icons", icons: ["A", "B", "C"] }, 3)).toEqual({ type: "icons", icons: ["A", "B", "C"] });
  });

  it("an unknown picture becomes a list", () => {
    expect(parseVisual({ visual: "hologram" }, 3)).toEqual({ type: "list", icons: [] });
  });

  it("not an object", () => {
    expect(parseVisual(null, 2)).toEqual({ type: "list", icons: [] });
  });

  it("icons keep their places and stop at the line count", () => {
    expect(parseVisual({ visual: "flow", icons: ["a", 5, "b", "c"] }, 3).icons).toEqual(["a", "", "b"]);
  });

  it("a stat", () => {
    expect(parseVisual({ visual: "stat", stat: { value: " 50% ", label: "better" } }, 0)).toEqual({ type: "stat", icons: [], stat: { value: "50%", label: "better" } });
  });

  it("a stat with no value becomes a list", () => {
    const v = parseVisual({ visual: "stat", stat: { label: "x" } }, 2);
    expect(v.type).toBe("list");
    expect(v.stat).toBeUndefined();
  });

  it("a comparison", () => {
    expect(parseVisual({ visual: "compare", compare: { leftTitle: "Manual", rightTitle: "AI", left: ["Slow"], right: ["Fast", "Cheap"] } }, 0)).toEqual({ type: "compare", icons: [], compare: { leftTitle: "Manual", rightTitle: "AI", left: ["Slow"], right: ["Fast", "Cheap"] } });
  });

  it("a comparison missing one side becomes a list", () => {
    expect(parseVisual({ visual: "compare", compare: { left: ["Slow"], right: [] } }, 2).type).toBe("list");
  });

  it("comparison titles default", () => {
    expect(parseVisual({ visual: "compare", compare: { left: ["a"], right: ["b"] } }, 0).compare).toEqual({ leftTitle: "Before", rightTitle: "After", left: ["a"], right: ["b"] });
  });

  it("icons or a flow need two lines", () => {
    expect(parseVisual({ visual: "icons" }, 1).type).toBe("list");
    expect(parseVisual({ visual: "flow" }, 0).type).toBe("list");
  });
});

describe("parseAnimationScript", () => {
  const raw = JSON.stringify({ title: "T", scenes: [
    { kind: "title", heading: "T", lines: ["a"], narration: "Hello.", visual: "list", icons: ["X"] },
    { kind: "point", heading: "skipped", lines: ["x", "y"], narration: "", visual: "flow" },
    { kind: "point", heading: "Ways", lines: ["One", "Two"], narration: "Two ways.", visual: "icons", icons: ["1", "2"] },
    { kind: "credits", heading: "", lines: [], narration: "Bye." },
  ] });

  it("pictures stay with their scenes when one scene is skipped", () => {
    const s = parseAnimationScript(raw);
    expect(s.scenes).toHaveLength(3);
    expect(s.scenes[1].heading).toBe("Ways");
    expect(s.scenes[0].visual).toEqual({ type: "list", icons: ["X"] });
    expect(s.scenes[1].visual).toEqual({ type: "icons", icons: ["1", "2"] });
    expect(s.scenes[2].visual).toEqual({ type: "list", icons: [] });
  });

  it("words around the JSON are ignored", () => {
    expect(parseAnimationScript("Here you go:\n" + raw + "\nDone").scenes).toHaveLength(3);
  });

  it("an answer that is not a script throws", () => {
    expect(() => parseAnimationScript("nope")).toThrow("The AI's answer wasn't a script. Try again.");
  });
});

describe("buildAnimationPrompt", () => {
  it("uses the animation system prompt and the documentary user prompt", () => {
    const cues = [{ start: 0, end: 5, text: "Hello there." }];
    const p = buildAnimationPrompt("My title", cues, { minutes: 2, language: "English" });
    expect(p.system).toContain('"visual"');
    expect(p.system).toContain("emoji");
    expect(p.user).toBe(buildScriptPrompt("My title", cues, { minutes: 2, language: "English" }).user);
  });
});

describe("firstGlyph", () => {
  it("returns the first visible character or an empty string", () => {
    expect(firstGlyph("  hello")).toBe("h");
    expect(firstGlyph("")).toBe("");
    expect(firstGlyph("   ")).toBe("");
  });
});

describe("countUp", () => {
  it("scales a percentage", () => {
    expect(countUp("50%", 0.5)).toBe("25%");
  });

  it("scales a decimal", () => {
    expect(countUp("5.6 billion", 0.5)).toBe("2.8 billion");
  });

  it("scales a small comma number", () => {
    expect(countUp("$1,200", 0.5)).toBe("$600");
  });

  it("scales a comma number with grouping", () => {
    expect(countUp("$12,000", 0.5)).toBe("$6,000");
  });

  it("scales a large comma number", () => {
    expect(countUp("1,000,000 users", 0.25)).toBe("250,000 users");
  });

  it("clamps progress at zero", () => {
    expect(countUp("50%", 0)).toBe("0%");
    expect(countUp("50%", -1)).toBe("0%");
  });

  it("returns the value at or above full progress", () => {
    expect(countUp("$1,200", 1)).toBe("$1,200");
    expect(countUp("50%", 2)).toBe("50%");
  });

  it("leaves text without a number alone", () => {
    expect(countUp("many", 0.3)).toBe("many");
  });
});
