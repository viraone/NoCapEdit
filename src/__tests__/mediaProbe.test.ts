import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "@/lib/media/probe";

afterEach(() => {
  vi.useRealTimers();
});

describe("probe timeout", () => {
  it("passes a value through and clears its timer", async () => {
    vi.useFakeTimers();
    const result = withTimeout(Promise.resolve("ready"), 60_000, "Reading the video");

    await expect(result).resolves.toBe("ready");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the step and the advice when the deadline passes", async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<never>(() => {}), 60_000, "Reading the audio");
    const assertion = expect(pending).rejects.toThrow(
      "Reading the audio took too long. Your computer may be busy; try again in a moment.",
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the original rejection and clears its timer", async () => {
    vi.useFakeTimers();
    const failure = new Error("This file could not be decoded by your browser.");
    const pending = withTimeout(Promise.reject(failure), 60_000, "Reading the video");

    await expect(pending).rejects.toBe(failure);
    expect(vi.getTimerCount()).toBe(0);
  });
});
