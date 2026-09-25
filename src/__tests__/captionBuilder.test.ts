import { describe, expect, it } from "vitest";
import { buildCues, CAPTION_RULES, cuesEditedSince, mergeCues, regroupCues, splitCue } from "@/lib/speech/captionBuilder";
import type { WordTiming } from "@/lib/models/project";

const w = (text: string, start: number, end: number): WordTiming => ({ text, start, end });

describe("buildCues", () => {
  it("caps cues at 4 words", () => {
    const words = ["a", "b", "c", "d", "e", "f"].map((t, i) => w(t, i * 0.3, i * 0.3 + 0.2));
    const cues = buildCues(words);
    expect(cues.map((c) => c.text)).toEqual(["a b c d", "e f"]);
  });

  it("ends a cue when it would exceed 2.4 seconds", () => {
    const words = [w("one", 0, 0.5), w("two", 1, 1.5), w("three", 2, 2.6), w("four", 2.7, 3)];
    const cues = buildCues(words);
    expect(cues.map((c) => c.text)).toEqual(["one two", "three four"]);
  });

  it("breaks on pauses longer than 0.6 seconds", () => {
    const words = [w("hi", 0, 0.3), w("there", 0.4, 0.7), w("friend", 1.5, 1.9)];
    const cues = buildCues(words);
    expect(cues.map((c) => c.text)).toEqual(["hi there", "friend"]);
    expect(cues[0].end).toBeCloseTo(0.7 + CAPTION_RULES.tail, 5);
  });

  it("adds a 0.25 s tail and enforces a 0.5 s minimum", () => {
    const cues = buildCues([w("quick", 1, 1.1)]);
    expect(cues[0].start).toBe(1);
    expect(cues[0].end).toBeCloseTo(1.5, 5);
    const long = buildCues([w("long", 0, 1)]);
    expect(long[0].end).toBeCloseTo(1.25, 5);
  });

  it("never lets cues overlap", () => {
    const words = [w("a", 0, 0.1), w("b", 0.12, 0.2), w("c", 0.22, 0.3), w("d", 0.32, 0.4), w("e", 0.45, 0.5)];
    const cues = buildCues(words);
    expect(cues).toHaveLength(2);
    expect(cues[0].end).toBeLessThanOrEqual(cues[1].start);
  });

  it("keeps word timings for highlighting", () => {
    const cues = buildCues([w("hello", 0, 0.4), w("world", 0.5, 0.9)]);
    expect(cues[0].words).toEqual([w("hello", 0, 0.4), w("world", 0.5, 0.9)]);
  });

  it("drops empty words and sorts by time", () => {
    const cues = buildCues([w("later", 2, 2.3), w("  ", 0.5, 0.6), w("first", 0, 0.3)]);
    expect(cues.map((c) => c.text)).toEqual(["first", "later"]);
  });
});

describe("mergeCues / splitCue", () => {
  it("merges text and words in time order", () => {
    const [a, b] = buildCues([w("a", 0, 0.2), w("b", 1.5, 1.7)]);
    const merged = mergeCues(b, a);
    expect(merged.text).toBe("a b");
    expect(merged.start).toBe(0);
    expect(merged.words).toHaveLength(2);
  });
  it("splits at a word boundary using word timings", () => {
    const [cue] = buildCues([w("one", 0, 0.2), w("two", 0.3, 0.5), w("three", 0.6, 0.8)]);
    const parts = splitCue(cue, 1);
    expect(parts).not.toBeNull();
    expect(parts![0].text).toBe("one");
    expect(parts![1].text).toBe("two three");
    expect(parts![0].end).toBe(0.3);
    expect(parts![1].start).toBe(0.3);
  });
});

describe("cuesEditedSince", () => {
  it("finds new and changed cues by content, not identity", () => {
    const before = buildCues([w("a", 0, 0.3), w("b", 2, 2.3)]);
    const after = structuredClone(before);
    expect(cuesEditedSince(before, after)).toEqual([]); // a clone is not an edit
    after[1].text = "edited";
    const added = { ...before[0], id: "new", start: 5, end: 6, text: "imported" };
    const edited = cuesEditedSince(before, [...after, added]);
    expect(edited.map((c) => c.text)).toEqual(["edited", "imported"]);
  });
});

describe("regroupCues", () => {
  const regroup = (cues: ReturnType<typeof buildCues>, maxWords: number) => regroupCues(cues, (words) => buildCues(words, { ...CAPTION_RULES, maxWords }));

  it("regroups from the edited text, keeping the stored timings when the word count matches", () => {
    const cues = buildCues([w("one", 0, 0.2), w("two", 0.2, 0.4), w("three", 0.4, 0.6), w("four", 0.6, 0.8)]);
    cues[0].text = "ONE TWO THREE FOUR";
    const out = regroup(cues, 2);
    expect(out.map((c) => c.text)).toEqual(["ONE TWO", "THREE FOUR"]);
    expect(out[1].words?.[0].start).toBeCloseTo(0.4);
  });

  it("keeps cues without word timings exactly as they are", () => {
    const timed = buildCues([w("hello", 0, 0.3), w("there", 0.3, 0.6)]);
    const handMade = { id: "hand", start: 3, end: 4, text: "added by hand" } as unknown as (typeof timed)[number];
    const out = regroup([...timed, handMade], 6);
    expect(out.map((c) => c.text)).toEqual(["hello there", "added by hand"]);
    expect(out[1]).toBe(handMade);
  });

  it("carries a timed cue's anchor over to the cue its first word lands in", () => {
    const timed = buildCues([w("hello", 0, 0.3), w("there", 0.3, 0.6)]);
    timed[0].anchor = { x: 0.3, y: 0.2 } as never;
    expect(regroup(timed, 6)[0].anchor).toEqual({ x: 0.3, y: 0.2 });
  });
});
