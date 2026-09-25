import { describe, expect, it } from "vitest";
import { createFocusModality, isActivatableTarget } from "@/components/editor/spaceShortcut";

describe("isActivatableTarget", () => {
  it("recognises buttons, switches, tiles and links by role/tag", () => {
    const closestFor = (matches: boolean) => ({ closest: () => (matches ? {} : null) }) as unknown as EventTarget;
    expect(isActivatableTarget(closestFor(true))).toBe(true);
    expect(isActivatableTarget(closestFor(false))).toBe(false);
    expect(isActivatableTarget(null)).toBe(false);
  });
});

describe("createFocusModality", () => {
  it("marks a Tab-focused (or scripted) control as not pointer-focused", () => {
    const m = createFocusModality();
    m.tab();
    m.focusIn();
    expect(m.isPointerFocused()).toBe(false);
  });

  it("marks a click-focused control as pointer-focused", () => {
    const m = createFocusModality();
    m.pointerDown();
    m.focusIn(); // the click's focus change fires between pointerdown and pointerup
    m.pointerUp();
    expect(m.isPointerFocused()).toBe(true);
  });

  it("marks a click on an already-focused control as pointer-focused even with no focusin", () => {
    const m = createFocusModality();
    m.pointerDown();
    m.pointerUp();
    expect(m.isPointerFocused()).toBe(true);
  });

  it("clears on blur and after a later Tab press", () => {
    const m = createFocusModality();
    m.pointerDown();
    m.focusIn();
    m.pointerUp();
    m.focusOut();
    expect(m.isPointerFocused()).toBe(false);
    m.pointerDown();
    m.focusIn();
    m.pointerUp();
    m.tab();
    m.focusIn(); // Tab moves focus to the next element
    expect(m.isPointerFocused()).toBe(false);
  });
});
