import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { whenVisible } from "@/lib/media/visibility";

/**
 * The suite runs without a browser, so a tiny stand-in document provides the
 * three things the gate uses: `hidden`, and visibilitychange listeners.
 */
type FakeDocument = EventTarget & { hidden: boolean };
let doc: FakeDocument;
const tick = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => {
  doc = Object.assign(new EventTarget(), { hidden: false });
  (globalThis as { document?: unknown }).document = doc;
});
afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
});

describe("whenVisible", () => {
  it("resolves at once while the tab is in front, without reporting a pause", async () => {
    const calls: boolean[] = [];
    await whenVisible((h) => calls.push(h));
    expect(calls).toEqual([]);
  });

  it("waits while the tab is hidden and carries on when it comes back, reporting both", async () => {
    doc.hidden = true;
    const calls: boolean[] = [];
    let settled = false;
    const gate = whenVisible((h) => calls.push(h)).then(() => {
      settled = true;
    });
    await tick();
    expect(settled).toBe(false);
    expect(calls).toEqual([true]);
    // A visibilitychange that still reports hidden must not open the gate.
    doc.dispatchEvent(new Event("visibilitychange"));
    await tick();
    expect(settled).toBe(false);
    doc.hidden = false;
    doc.dispatchEvent(new Event("visibilitychange"));
    await gate;
    expect(settled).toBe(true);
    expect(calls).toEqual([true, false]);
  });

  it("resolves at once when there is no document at all (server-side)", async () => {
    delete (globalThis as { document?: unknown }).document;
    await expect(whenVisible()).resolves.toBeUndefined();
  });
});
