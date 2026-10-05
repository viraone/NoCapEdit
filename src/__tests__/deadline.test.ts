import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "@/lib/ffmpeg/deadline";

describe("withDeadline", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("passes a result through and never fires the timeout", async () => {
    const onTimeout = vi.fn(() => new Error("late"));
    const p = withDeadline(Promise.resolve(42), 1000, onTimeout);
    await expect(p).resolves.toBe(42);
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("passes a rejection through", async () => {
    const onTimeout = vi.fn(() => new Error("late"));
    await expect(withDeadline(Promise.reject(new Error("boom")), 1000, onTimeout)).rejects.toThrow("boom");
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it("gives up on a call that never answers, runs onTimeout once, and rejects with its error", async () => {
    const onTimeout = vi.fn(() => new Error("The video engine stopped responding."));
    const p = withDeadline(new Promise<never>(() => undefined), 20_000, onTimeout);
    const caught = p.catch((e) => e);
    vi.advanceTimersByTime(19_999);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2);
    expect((await caught).message).toBe("The video engine stopped responding.");
    vi.advanceTimersByTime(60_000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it("ignores a late answer after it gave up", async () => {
    let answer!: (v: string) => void;
    const slow = new Promise<string>((r) => (answer = r));
    const p = withDeadline(slow, 1000, () => new Error("gave up"));
    const caught = p.catch((e) => e);
    vi.advanceTimersByTime(1001);
    answer("too late");
    expect((await caught).message).toBe("gave up");
  });
});
