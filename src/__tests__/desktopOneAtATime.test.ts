import { describe, expect, it } from "vitest";
import { Busy, createGate } from "../../desktop/lib/oneAtATime.mjs";

describe("oneAtATime gate", () => {
  it("returns the result of work", async () => {
    const gate = createGate();
    const result = await gate.run(async () => 42);
    expect(result).toBe(42);
  });

  it("rejects with Busy when a job is working and not cancelled", async () => {
    const gate = createGate();
    let resolveWork: () => void;
    const workPromise = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });

    const firstRun = gate.run(async () => {
      await workPromise;
      return "first";
    });

    let workCalled = false;
    const secondRun = gate.run(async () => {
      workCalled = true;
      return "second";
    });

    await expect(secondRun).rejects.toBeInstanceOf(Busy);
    expect(workCalled).toBe(false);

    resolveWork!();
    await firstRun;
  });

  it("runs a new job after the first finishes", async () => {
    const gate = createGate();
    let resolveWork: () => void;
    const workPromise = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });

    const firstRun = gate.run(async () => {
      await workPromise;
      return "first";
    });

    resolveWork!();
    await firstRun;

    const secondResult = await gate.run(async () => "second");
    expect(secondResult).toBe("second");
  });

  it("cancel() marks the working job as cancelled", async () => {
    const gate = createGate();
    let resolveWork: () => void;
    const workPromise = new Promise<void>((resolve) => {
      resolveWork = resolve;
    });

    let jobRef: { cancelled: boolean } | undefined;
    const firstRun = gate.run(async (job) => {
      jobRef = job;
      await workPromise;
      return "first";
    });

    gate.cancel();
    expect(jobRef?.cancelled).toBe(true);

    resolveWork!();
    await firstRun;
  });

  it("a run started after cancel waits for the old one to finish before its work is called", async () => {
    const gate = createGate();
    let resolveWork1: () => void;
    const workPromise1 = new Promise<void>((resolve) => {
      resolveWork1 = resolve;
    });

    const firstRun = gate.run(async () => {
      await workPromise1;
      return "first";
    });

    gate.cancel();

    let work2Called = false;
    const secondRun = gate.run(async () => {
      work2Called = true;
      return "second";
    });

    expect(work2Called).toBe(false);

    resolveWork1!();
    await firstRun;
    await secondRun;
    expect(work2Called).toBe(true);
  });

  it("cancel() during the wait gives the waiting job cancelled === true", async () => {
    const gate = createGate();
    let resolveWork1: () => void;
    const workPromise1 = new Promise<void>((resolve) => {
      resolveWork1 = resolve;
    });

    const firstRun = gate.run(async () => {
      await workPromise1;
      return "first";
    });

    gate.cancel();

    let job2Ref: { cancelled: boolean } | undefined;
    const secondRun = gate.run(async (job) => {
      job2Ref = job;
      return "second";
    });

    gate.cancel();

    resolveWork1!();
    await firstRun;
    await secondRun;
    
    expect(job2Ref?.cancelled).toBe(true);
  });

  it("two waiters: one runs, the other rejects with Busy", async () => {
    const gate = createGate();
    let resolveWork1: () => void;
    const workPromise1 = new Promise<void>((resolve) => {
      resolveWork1 = resolve;
    });

    const firstRun = gate.run(async () => {
      await workPromise1;
      return "first";
    });

    gate.cancel();

    let work2Called = false;
    const secondRun = gate.run(async () => {
      work2Called = true;
      return "second";
    });

    let work3Called = false;
    const thirdRun = gate.run(async () => {
      work3Called = true;
      return "third";
    });

    resolveWork1!();
    await firstRun;

    await expect(thirdRun).rejects.toBeInstanceOf(Busy);
    expect(work3Called).toBe(false);

    await secondRun;
    expect(work2Called).toBe(true);
  });

  it("a rejecting work frees the gate", async () => {
    const gate = createGate();
    const firstRun = gate.run(async () => {
      throw new Error("fail");
    });

    await expect(firstRun).rejects.toThrow("fail");

    const secondResult = await gate.run(async () => "second");
    expect(secondResult).toBe("second");
  });

  it("a synchronously throwing work frees the gate", async () => {
    const gate = createGate();
    const firstRun = gate.run(() => {
      throw new Error("sync fail");
    });

    await expect(firstRun).rejects.toThrow("sync fail");

    const secondResult = await gate.run(async () => "second");
    expect(secondResult).toBe("second");
  });
});
