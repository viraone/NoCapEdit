import { describe, expect, it } from "vitest";
import { capRepeats, cleanWords, dropTimestampBursts } from "@/lib/mobile/cleanWords";
import type { WordTiming } from "@/lib/models/project";

function w(text: string, start: number, end = start + 0.3): WordTiming {
  return { text, start, end };
}

describe("cleanWords", () => {
  it("drops a burst of words stamped at the same instant", () => {
    const burst = Array.from({ length: 12 }, () => w("yeah,", 29.0, 29.0));
    const words = [w("hello", 1), w("there", 1.4), ...burst, w("okay", 31)];
    const out = dropTimestampBursts(words);
    expect(out.map((x) => x.text)).toEqual(["hello", "there", "okay"]);
  });

  it("keeps a short run of same-time words (could be a fast phrase)", () => {
    const words = [w("a", 1), w("b", 1.05), w("c", 1.1)];
    expect(dropTimestampBursts(words)).toHaveLength(3);
  });

  it("caps a repeated word at three", () => {
    const words = Array.from({ length: 10 }, (_, i) => w("Yeah,", i * 0.4));
    expect(capRepeats(words).map((x) => x.text)).toEqual(["Yeah,", "Yeah,", "Yeah,"]);
  });

  it("caps a repeated phrase at three", () => {
    const phrase = ["I'm", "just", "gonna", "do", "that."];
    const words: WordTiming[] = [];
    for (let r = 0; r < 6; r++) phrase.forEach((t, k) => words.push(w(t, r * 2 + k * 0.3)));
    const out = capRepeats(words);
    expect(out).toHaveLength(15);
    expect(out.slice(0, 5).map((x) => x.text)).toEqual(phrase);
  });

  it("leaves genuine speech alone", () => {
    const words = ["Welcome", "to", "Real", "Flow.", "This", "short", "clip", "tests", "automatic", "captions."].map((t, i) => w(t, i * 0.4));
    expect(cleanWords(words)).toEqual(words);
  });
});
