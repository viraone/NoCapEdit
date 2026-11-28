import { describe, expect, it } from "vitest";
import { loadOpener, parseClock } from "@/lib/recap/opener";

describe("parseClock", () => {
  it("reads minutes and seconds, including a fraction", () => {
    expect(parseClock("4:06.6")).toBeCloseTo(246.6, 5);
  });

  it("reads plain seconds", () => {
    expect(parseClock("12")).toBe(12);
  });

  it("reads hours, minutes and seconds", () => {
    expect(parseClock("1:02:03")).toBe(3723);
  });

  it("returns null for empty text", () => {
    expect(parseClock("")).toBeNull();
    expect(parseClock("   ")).toBeNull();
  });

  it("returns null for a negative time", () => {
    expect(parseClock("-1:02")).toBeNull();
  });

  it("returns null when a part is not a number", () => {
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:x")).toBeNull();
    expect(parseClock("1:")).toBeNull();
  });

  it("returns null when a part after the first is 60 or more", () => {
    expect(parseClock("1:60")).toBeNull();
    expect(parseClock("1:02:60")).toBeNull();
  });
});

describe("loadOpener", () => {
  it("returns null when the browser has no IndexedDB", async () => {
    expect(typeof indexedDB).toBe("undefined");
    await expect(loadOpener()).resolves.toBeNull();
  });
});
