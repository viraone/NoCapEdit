import { describe, expect, it } from "vitest";
import { buildTimeline, clamp01, lineRevealTimes, reveal, sceneAt, splitSentences } from "@/lib/documentary/timeline";

describe("buildTimeline", () => {
  const scenes = [{ kind: "title" as const }, { kind: "point" as const }, { kind: "credits" as const }];
  const tl = buildTimeline(scenes, [4, 10, 2]);

  it("lays scenes end to end with a lead before and a tail after the narration", () => {
    expect(tl.scenes[0]).toMatchObject({ start: 0, speechStart: 1.2, speech: 4 });
    expect(tl.scenes[0].end).toBeCloseTo(1.2 + 4 + 0.7);
    expect(tl.scenes[1].start).toBeCloseTo(tl.scenes[0].end);
    expect(tl.scenes[1].speechStart).toBeCloseTo(tl.scenes[1].start + 0.6);
    expect(tl.total).toBeCloseTo(tl.scenes[2].end);
    expect(tl.scenes[2].end - tl.scenes[2].start).toBeCloseTo(0.6 + 2 + 2);
  });

  it("finds the scene on screen, clamping past the end", () => {
    expect(sceneAt(tl, 0).index).toBe(0);
    expect(sceneAt(tl, tl.scenes[1].start + 0.01).index).toBe(1);
    expect(sceneAt(tl, tl.total + 50).index).toBe(2);
  });
});

describe("animation helpers", () => {
  it("clamps and eases", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(reveal(0, 1)).toBe(0);
    expect(reveal(5, 1)).toBe(1);
    expect(reveal(1.275, 1)).toBeGreaterThan(0.5);
  });
  it("spreads line reveals across the narration", () => {
    const timing = { index: 1, start: 0, end: 20, speechStart: 0.6, speech: 10 };
    const times = lineRevealTimes(timing, 3, "point");
    expect(times).toHaveLength(3);
    expect(times[0]).toBeLessThan(times[1]);
    expect(times[2]).toBeLessThan(timing.speech);
    expect(lineRevealTimes(timing, 0, "point")).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("splits on sentence ends and joins tiny fragments to the next", () => {
    expect(splitSentences("This is the first full sentence. And this is the second full sentence! Ok?")).toEqual(["This is the first full sentence.", "And this is the second full sentence! Ok?"]);
    expect(splitSentences("Hi. This is a longer second sentence.")).toEqual(["Hi. This is a longer second sentence."]);
  });
  it("splits an over-long sentence at a comma or space", () => {
    const long = `${"alpha beta gamma, ".repeat(30)}end.`;
    const parts = splitSentences(long, 100);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((p) => p.length <= 100)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(long.replace(/\s+/g, " ").trim());
  });
  it("is empty for blank text", () => {
    expect(splitSentences("   ")).toEqual([]);
  });
});
