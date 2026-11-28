import { afterEach, describe, expect, it, vi } from "vitest";
import { whileBusy, busyJobs } from "@/lib/utils/busy";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("whileBusy", () => {
  it("passes the result through", async () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("window", { addEventListener: add, removeEventListener: remove });
    const result = await whileBusy(async () => 42);
    expect(result).toBe(42);
    expect(busyJobs()).toBe(0);
  });

  it("adds the listener once for two overlapping jobs and removes it only after both finish", async () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("window", { addEventListener: add, removeEventListener: remove });

    let resolve1: () => void;
    let resolve2: () => void;
    const p1 = new Promise<void>((r) => (resolve1 = r));
    const p2 = new Promise<void>((r) => (resolve2 = r));

    const job1 = whileBusy(() => p1);
    const job2 = whileBusy(() => p2);

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
    expect(busyJobs()).toBe(2);

    resolve1!();
    await job1;
    expect(remove).not.toHaveBeenCalled();
    expect(busyJobs()).toBe(1);

    resolve2!();
    await job2;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(busyJobs()).toBe(0);
  });

  it("removes the listener after a throwing job", async () => {
    const add = vi.fn();
    const remove = vi.fn();
    vi.stubGlobal("window", { addEventListener: add, removeEventListener: remove });

    await expect(
      whileBusy(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(add).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(busyJobs()).toBe(0);
  });

  it("works with no window", async () => {
    const result = await whileBusy(async () => "ok");
    expect(result).toBe("ok");
    expect(busyJobs()).toBe(0);
  });
});
