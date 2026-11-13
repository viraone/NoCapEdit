import { describe, expect, it } from "vitest";
import { nextRetryDelay } from "@/lib/saveRetry";

describe("autosave retry delays", () => {
  it("backs off 2 s, 5 s, 15 s, then settles at every 30 s", () => {
    expect(nextRetryDelay(0)).toBe(2000);
    expect(nextRetryDelay(1)).toBe(5000);
    expect(nextRetryDelay(2)).toBe(15000);
    expect(nextRetryDelay(3)).toBe(30000);
    expect(nextRetryDelay(4)).toBe(30000);
    expect(nextRetryDelay(100)).toBe(30000);
  });

  it("falls back to the first delay for a bad attempt number", () => {
    expect(nextRetryDelay(-1)).toBe(2000);
    expect(nextRetryDelay(0.5)).toBe(2000);
    expect(nextRetryDelay(1.7)).toBe(5000);
    expect(nextRetryDelay(Number.NaN)).toBe(2000);
    expect(nextRetryDelay(Number.POSITIVE_INFINITY)).toBe(2000);
  });
});
