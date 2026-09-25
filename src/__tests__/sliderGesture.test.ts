import { describe, expect, it } from "vitest";
import { createSliderGesture } from "@/components/ui/sliderGesture";

/** A store with one global transaction, like editorStore. */
function fakeStore() {
  const s = { open: false, dirty: false, steps: 0 };
  return {
    s,
    begin: () => (s.open ? false : ((s.open = true), (s.dirty = false), true)),
    end: () => {
      if (!s.open) return false;
      s.open = false;
      if (!s.dirty) return false;
      s.steps++;
      return true;
    },
    edit: () => void (s.dirty = true),
  };
}

describe("slider gesture", () => {
  it("makes a pointer drag one undo step", () => {
    const st = fakeStore();
    const g = createSliderGesture(st);
    g.pointerDown();
    st.edit();
    g.pointerUp();
    g.blur();
    expect(st.s.steps).toBe(1);
    expect(st.s.open).toBe(false);
  });

  it("never closes a transaction it did not open (two sliders in a row)", () => {
    const st = fakeStore();
    const a = createSliderGesture(st);
    const b = createSliderGesture(st);
    a.pointerDown();
    st.edit();
    a.pointerUp(); // step 1
    b.pointerDown(); // b's transaction opens
    a.blur(); // a lost focus: must not touch b's transaction
    expect(st.s.open).toBe(true);
    st.edit();
    b.pointerUp();
    expect(st.s.steps).toBe(2);
  });

  it("gives keyboard nudges an undo step, folds quick repeats into it, and starts a new step after a pause", () => {
    const st = fakeStore();
    let t = 0;
    const g = createSliderGesture(st, () => t);
    g.keyDown("ArrowRight", false);
    st.edit();
    g.keyUp();
    expect(st.s.steps).toBe(1);
    t += 50; // key repeat
    g.keyDown("ArrowRight", false);
    st.edit();
    g.keyUp();
    expect(st.s.steps).toBe(1);
    t += 1000; // a pause: the next nudge is its own step
    g.keyDown("ArrowRight", false);
    st.edit();
    g.keyUp();
    expect(st.s.steps).toBe(2);
    t += 50;
    g.blur();
    g.keyDown("End", false);
    st.edit();
    g.keyUp();
    expect(st.s.steps).toBe(3); // blur always ends the burst
  });

  it("starts a fresh step after an undo chord and ignores a nudge that changes nothing", () => {
    const st = fakeStore();
    const g = createSliderGesture(st);
    g.keyDown("ArrowRight", false);
    g.keyUp(); // at the limit: nothing changed, no step
    expect(st.s.steps).toBe(0);
    g.keyDown("ArrowLeft", false);
    st.edit();
    g.keyUp();
    expect(st.s.steps).toBe(1);
    g.keyDown("z", true); // Cmd+Z while focused
    g.keyDown("ArrowLeft", false);
    st.edit();
    g.keyUp();
    expect(st.s.steps).toBe(2);
  });

  it("is inert without handlers", () => {
    const g = createSliderGesture({});
    g.pointerDown();
    g.keyDown("Home", false);
    g.keyUp();
    g.pointerUp();
    g.blur();
  });
});
