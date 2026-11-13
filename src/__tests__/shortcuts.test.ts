import { describe, expect, it } from "vitest";
import { shortcutFor, type ShortcutEvent } from "@/lib/shortcuts";

const ev = (key: string, over: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

const target = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;

describe("shortcutFor: play / pause", () => {
  it("is the Space key, whether the browser fills in code or only key", () => {
    expect(shortcutFor(ev(" ", { code: "Space" }))).toBe("play-pause");
    expect(shortcutFor(ev(" "))).toBe("play-pause");
  });

  it("gives way to a control that already handled the key", () => {
    expect(shortcutFor(ev(" ", { code: "Space", defaultPrevented: true }))).toBeNull();
  });

  it("is not a shortcut while typing or inside a native control", () => {
    expect(shortcutFor(ev(" ", { target: target("INPUT", { type: "text" }) }))).toBeNull();
    expect(shortcutFor(ev(" ", { target: target("TEXTAREA") }))).toBeNull();
    expect(shortcutFor(ev(" ", { target: target("SELECT") }))).toBeNull();
    expect(shortcutFor(ev(" ", { target: target("DIV", { isContentEditable: true }) }))).toBeNull();
    expect(shortcutFor(ev(" ", { target: target("INPUT", { type: "range" }) }))).toBeNull();
  });
});

describe("shortcutFor: split at the playhead", () => {
  it("is S with no modifier or Alt, in either case, with or without Shift", () => {
    expect(shortcutFor(ev("s"))).toBe("split-at-playhead");
    expect(shortcutFor(ev("S", { shiftKey: true }))).toBe("split-at-playhead");
  });

  it("keeps the older Cmd/Ctrl+B shortcut", () => {
    expect(shortcutFor(ev("b", { metaKey: true }))).toBe("split-at-playhead");
    expect(shortcutFor(ev("B", { ctrlKey: true, shiftKey: true }))).toBe("split-at-playhead");
  });

  it("does not fire with another modifier or in a text field", () => {
    expect(shortcutFor(ev("s", { metaKey: true }))).toBeNull(); // browser Save
    expect(shortcutFor(ev("s", { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(ev("s", { altKey: true }))).toBeNull();
    expect(shortcutFor(ev("s", { target: target("INPUT", { type: "text" }) }))).toBeNull();
    expect(shortcutFor(ev("s", { target: target("DIV", { isContentEditable: true }) }))).toBeNull();
  });
});

describe("shortcutFor: undo / redo", () => {
  it("is Cmd/Ctrl+Z for undo", () => {
    expect(shortcutFor(ev("z", { metaKey: true }))).toBe("undo");
    expect(shortcutFor(ev("Z", { ctrlKey: true }))).toBe("undo");
  });

  it("is Cmd/Ctrl+Shift+Z or Cmd/Ctrl+Y for redo", () => {
    expect(shortcutFor(ev("z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(ev("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(shortcutFor(ev("y", { metaKey: true }))).toBe("redo");
    expect(shortcutFor(ev("Y", { ctrlKey: true }))).toBe("redo");
  });

  it("does not stop Alt-chord undo outside text fields, matching the editor's old behaviour", () => {
    expect(shortcutFor(ev("z", { metaKey: true, altKey: true }))).toBe("undo");
  });

  it("leaves Cmd/Ctrl+Z to the browser inside text fields", () => {
    expect(shortcutFor(ev("z", { metaKey: true, target: target("INPUT", { type: "text" }) }))).toBeNull();
    expect(shortcutFor(ev("z", { metaKey: true, target: target("INPUT", { type: "number" }) }))).toBeNull();
    expect(shortcutFor(ev("z", { metaKey: true, target: target("TEXTAREA") }))).toBeNull();
    expect(shortcutFor(ev("z", { metaKey: true, target: target("DIV", { isContentEditable: true }) }))).toBeNull();
  });

  it("still undoes from a non-text native control, as before", () => {
    expect(shortcutFor(ev("z", { metaKey: true, target: target("INPUT", { type: "range" }) }))).toBe("undo");
    expect(shortcutFor(ev("z", { metaKey: true, target: target("INPUT", { type: "checkbox" }) }))).toBe("undo");
    // A select has no native edit history, so Ctrl+Z there is still the editor's.
    expect(shortcutFor(ev("z", { ctrlKey: true, target: target("SELECT") }))).toBe("undo");
  });

  it("ignores a bare Z", () => {
    expect(shortcutFor(ev("z"))).toBeNull();
  });
});

describe("shortcutFor: delete and seeking", () => {
  it("is Delete or Backspace for removing the selection", () => {
    expect(shortcutFor(ev("Delete"))).toBe("remove-selection");
    expect(shortcutFor(ev("Backspace"))).toBe("remove-selection");
    expect(shortcutFor(ev("Delete", { target: target("INPUT", { type: "text" }) }))).toBeNull();
    expect(shortcutFor(ev("Backspace", { target: target("TEXTAREA") }))).toBeNull();
  });

  it("is the arrow keys, with or without Shift (the caller picks the step)", () => {
    expect(shortcutFor(ev("ArrowLeft"))).toBe("seek-back");
    expect(shortcutFor(ev("ArrowRight"))).toBe("seek-forward");
    expect(shortcutFor(ev("ArrowLeft", { shiftKey: true }))).toBe("seek-back");
    expect(shortcutFor(ev("ArrowRight", { shiftKey: true }))).toBe("seek-forward");
    // Cmd+Arrow has always sought too; keep it.
    expect(shortcutFor(ev("ArrowLeft", { metaKey: true }))).toBe("seek-back");
    expect(shortcutFor(ev("ArrowRight", { target: target("INPUT", { type: "range" }) }))).toBeNull();
  });

  it("is Home and End for the ends of the timeline", () => {
    expect(shortcutFor(ev("Home"))).toBe("seek-start");
    expect(shortcutFor(ev("End"))).toBe("seek-end");
  });

  it("is Escape for clearing the selection", () => {
    expect(shortcutFor(ev("Escape"))).toBe("clear-selection");
    expect(shortcutFor(ev("Escape", { target: target("INPUT", { type: "text" }) }))).toBeNull();
  });
});

describe("shortcutFor: timeline zoom", () => {
  it("is + / = for zoom in and - / _ for zoom out, with or without Cmd/Ctrl", () => {
    expect(shortcutFor(ev("+"))).toBe("zoom-in");
    expect(shortcutFor(ev("+", { shiftKey: true }))).toBe("zoom-in");
    expect(shortcutFor(ev("="))).toBe("zoom-in");
    expect(shortcutFor(ev("-"))).toBe("zoom-out");
    expect(shortcutFor(ev("_", { shiftKey: true }))).toBe("zoom-out");
    expect(shortcutFor(ev("+", { metaKey: true }))).toBe("zoom-in");
    expect(shortcutFor(ev("+", { ctrlKey: true }))).toBe("zoom-in");
    expect(shortcutFor(ev("-", { metaKey: true }))).toBe("zoom-out");
    expect(shortcutFor(ev("-", { ctrlKey: true, shiftKey: true }))).toBe("zoom-out");
  });

  it("does not fire with Alt or in a text field", () => {
    expect(shortcutFor(ev("+", { altKey: true }))).toBeNull();
    expect(shortcutFor(ev("-", { altKey: true }))).toBeNull();
    expect(shortcutFor(ev("+", { target: target("INPUT", { type: "text" }) }))).toBeNull();
    expect(shortcutFor(ev("-", { target: target("DIV", { isContentEditable: true }) }))).toBeNull();
    expect(shortcutFor(ev("+", { target: target("INPUT", { type: "range" }) }))).toBeNull();
  });
});

describe("shortcutFor: everything else", () => {
  it("returns null for keys the editor does not claim", () => {
    for (const key of ["a", "Enter", "Tab", "PageUp", "PageDown", "F5", "0"]) {
      expect(shortcutFor(ev(key))).toBeNull();
    }
  });

  it("is null with no target at all, like before", () => {
    expect(shortcutFor(ev("Space", { code: "Space", target: null }))).toBe("play-pause");
    expect(shortcutFor(ev("Delete", { target: null }))).toBe("remove-selection");
  });
});
