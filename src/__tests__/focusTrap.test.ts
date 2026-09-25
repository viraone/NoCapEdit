import { describe, expect, it } from "vitest";
import { cycleTarget } from "@/lib/a11y/focusTrap";

describe("cycleTarget", () => {
  it("does nothing when there is nothing focusable", () => {
    expect(cycleTarget(0, -1, false)).toBeNull();
    expect(cycleTarget(0, -1, true)).toBeNull();
  });
  it("wraps forward from the last item (or from outside the dialog) to the first", () => {
    expect(cycleTarget(3, 2, false)).toBe("first");
    expect(cycleTarget(3, -1, false)).toBe("first");
  });
  it("wraps backward from the first item (or from outside) to the last", () => {
    expect(cycleTarget(3, 0, true)).toBe("last");
    expect(cycleTarget(3, -1, true)).toBe("last");
  });
  it("lets the browser move focus normally in the middle of the list", () => {
    expect(cycleTarget(3, 1, false)).toBeNull();
    expect(cycleTarget(3, 1, true)).toBeNull();
  });
});
