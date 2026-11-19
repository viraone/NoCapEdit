import { describe, expect, it } from "vitest";
import { ANIMATION_ACCENTS, easeOutBack } from "@/lib/documentary/drawAnimation";

describe("easeOutBack", () => {
  it("starts at 0 and ends at 1", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it("overshoots before settling", () => {
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });

  it("is clamped outside 0 to 1", () => {
    expect(easeOutBack(-5)).toBeCloseTo(0, 6);
    expect(easeOutBack(9)).toBeCloseTo(1, 6);
  });
});

describe("ANIMATION_ACCENTS", () => {
  it("is not empty and every entry is a hex colour", () => {
    expect(ANIMATION_ACCENTS.length).toBeGreaterThan(0);
    for (const colour of ANIMATION_ACCENTS) {
      expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
