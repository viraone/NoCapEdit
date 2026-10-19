import { describe, it, expect } from "vitest";
import { HASHTAG_POOL, buildRickshawPost, cleanHandle, formatShowDate, nextFriday, parseDateInput, parseHandles, pickHashtags, toDateInput } from "@/lib/ai/rickshawPost";

describe("handles", () => {
  it("adds the @ and strips what is not part of a handle", () => {
    expect(cleanHandle("danhurwitzcomedy")).toBe("@danhurwitzcomedy");
    expect(cleanHandle(" @@allegra.keys, ")).toBe("@allegra.keys");
    expect(cleanHandle("https://www.instagram.com/allegrakeys/?hl=en")).toBe("@allegrakeys");
    expect(cleanHandle("  ")).toBe("");
  });
  it("reads several handles and drops repeats", () => {
    expect(parseHandles("@a, b  @A\nc")).toEqual(["@a", "@b", "@c"]);
  });
});

describe("show date", () => {
  it("writes the day with its ordinal", () => {
    expect(formatShowDate(new Date(2026, 9, 2))).toBe("October 2nd");
    expect(formatShowDate(new Date(2026, 9, 3))).toBe("October 3rd");
    expect(formatShowDate(new Date(2026, 9, 11))).toBe("October 11th");
    expect(formatShowDate(new Date(2026, 9, 22))).toBe("October 22nd");
  });
  it("is today when today is a Friday, otherwise the next Friday", () => {
    expect(toDateInput(nextFriday(new Date(2026, 9, 23, 18)))).toBe("2026-10-23");
    expect(toDateInput(nextFriday(new Date(2026, 9, 19)))).toBe("2026-10-23");
    expect(toDateInput(nextFriday(new Date(2026, 9, 24)))).toBe("2026-10-30");
  });
  it("reads a date input as a local day", () => {
    expect(parseDateInput("2026-10-23")?.getDate()).toBe(23);
    expect(parseDateInput("nope")).toBeNull();
  });
});

describe("hashtags", () => {
  it("picks five different ones from the six", () => {
    for (let i = 0; i < 30; i++) {
      const tags = pickHashtags();
      expect(tags).toHaveLength(5);
      expect(new Set(tags).size).toBe(5);
      for (const t of tags) expect(HASHTAG_POOL).toContain(t);
    }
  });
  it("leaves out different ones over time", () => {
    const left = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const tags = pickHashtags();
      left.add(HASHTAG_POOL.find((h) => !tags.includes(h))!);
    }
    expect(left.size).toBeGreaterThan(1);
  });
});

describe("buildRickshawPost", () => {
  const tags = ["#PNWComedy", "#SeattleLiveEvents", "#SeattleComedyScene", "#SeattleComedy", "#SeattleThingsToDo"];
  it("matches the usual post", () => {
    expect(buildRickshawPost({ headliner: "@danhurwitzcomedy", features: ["@allegrakeys"], date: "October 2nd", hashtags: tags })).toBe(
      [
        "Rickshaw Read the Room Comedy Show is back. @danhurwitzcomedy headlines, @allegrakeys features.",
        "Friday, October 2nd, 7-9 PM. Free show.",
        "The Rickshaw, 322 N. 105th St, Seattle, WA 98133 (@rickshawseattle)",
        "Come through for good food, cold drinks, and funny people. Karaoke to follow. Support local comedy.",
        tags.join(" "),
      ].join("\n\n"),
    );
  });
  it("handles one comic, several features and missing pieces", () => {
    expect(buildRickshawPost({ headliner: "@a", features: [], date: "x", hashtags: [] })).toContain("is back. @a headlines.\n");
    expect(buildRickshawPost({ headliner: "@a", features: ["@b", "@c"], date: "x", hashtags: [] })).toContain("@a headlines, @b and @c feature.");
    const empty = buildRickshawPost({ headliner: "", features: [], date: "", hashtags: [] });
    expect(empty).toContain("{HEADLINER}");
    expect(empty).toContain("Friday, {DATE},");
  });
});
