import { describe, expect, it } from "vitest";
import { afterRun } from "@/lib/phone/afterRun";
import type { ReelOutcome } from "@/lib/phone/phoneBridge";

describe("afterRun", () => {
  const baseOutcome: ReelOutcome = {
    ready: true,
    notes: [],
  };

  it("returns stopped when cancelled is true", () => {
    expect(afterRun(baseOutcome, true, true)).toBe("stopped");
  });

  it("returns stopped when outcome.stoppedAt is cancelled", () => {
    const outcome: ReelOutcome = { ...baseOutcome, stoppedAt: "cancelled" };
    expect(afterRun(outcome, true, false)).toBe("stopped");
  });

  it("cancelled wins over a ready outcome with share on", () => {
    const outcome: ReelOutcome = { ...baseOutcome, ready: true };
    expect(afterRun(outcome, true, true)).toBe("stopped");
  });

  it("returns trim when not ready and stoppedAt is trim", () => {
    const outcome: ReelOutcome = { ...baseOutcome, ready: false, stoppedAt: "trim" };
    expect(afterRun(outcome, false, false)).toBe("trim");
  });

  it("returns editor when not ready and stoppedAt is editor", () => {
    const outcome: ReelOutcome = { ...baseOutcome, ready: false, stoppedAt: "editor" };
    expect(afterRun(outcome, false, false)).toBe("editor");
  });

  it("returns failed when not ready and stoppedAt is failed", () => {
    const outcome: ReelOutcome = { ...baseOutcome, ready: false, stoppedAt: "failed" };
    expect(afterRun(outcome, false, false)).toBe("failed");
  });

  it("returns failed when not ready and stoppedAt is undefined", () => {
    const outcome: ReelOutcome = { ...baseOutcome, ready: false };
    expect(afterRun(outcome, false, false)).toBe("failed");
  });

  it("returns held when share is true and problems has items", () => {
    const outcome: ReelOutcome = { ...baseOutcome, problems: ["missing tag"] };
    expect(afterRun(outcome, true, false)).toBe("held");
  });

  it("returns countdown when share is true and problems is empty", () => {
    const outcome: ReelOutcome = { ...baseOutcome, problems: [] };
    expect(afterRun(outcome, true, false)).toBe("countdown");
  });

  it("returns countdown when share is true and problems is missing", () => {
    expect(afterRun(baseOutcome, true, false)).toBe("countdown");
  });

  it("notes alone (problems empty or missing) still count down", () => {
    const outcomeWithNotes: ReelOutcome = { ...baseOutcome, notes: ["some note"] };
    expect(afterRun(outcomeWithNotes, true, false)).toBe("countdown");
  });

  it("returns ready when share is false", () => {
    expect(afterRun(baseOutcome, false, false)).toBe("ready");
  });

  it("problems with share off give ready", () => {
    const outcome: ReelOutcome = { ...baseOutcome, problems: ["missing tag"] };
    expect(afterRun(outcome, false, false)).toBe("ready");
  });
});
