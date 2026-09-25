import { describe, expect, it } from "vitest";
import { isNativeKeyOwner, isTextEntryTarget, isUndoRedoChord } from "@/components/editor/keyTargets";

const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra }) as unknown as EventTarget;

describe("isNativeKeyOwner", () => {
  it("is true for every native form control and contentEditable", () => {
    expect(isNativeKeyOwner(el("INPUT"))).toBe(true);
    expect(isNativeKeyOwner(el("TEXTAREA"))).toBe(true);
    expect(isNativeKeyOwner(el("SELECT"))).toBe(true);
    expect(isNativeKeyOwner(el("DIV", { isContentEditable: true }))).toBe(true);
  });
  it("is false for anything else, including null", () => {
    expect(isNativeKeyOwner(el("BUTTON"))).toBe(false);
    expect(isNativeKeyOwner(el("DIV"))).toBe(false);
    expect(isNativeKeyOwner(null)).toBe(false);
  });
});

describe("isTextEntryTarget", () => {
  it("is true for textareas, contentEditable, and text-like input types", () => {
    expect(isTextEntryTarget(el("TEXTAREA"))).toBe(true);
    expect(isTextEntryTarget(el("DIV", { isContentEditable: true }))).toBe(true);
    for (const type of ["text", "search", "url", "tel", "email", "password", "number", ""]) {
      expect(isTextEntryTarget(el("INPUT", { type }))).toBe(true);
    }
    expect(isTextEntryTarget(el("INPUT", {}))).toBe(true); // no type attribute defaults to text
  });
  it("is false for range, color, checkbox, file inputs and selects", () => {
    for (const type of ["range", "color", "checkbox", "radio", "file", "date"]) {
      expect(isTextEntryTarget(el("INPUT", { type }))).toBe(false);
    }
    expect(isTextEntryTarget(el("SELECT"))).toBe(false);
    expect(isTextEntryTarget(el("BUTTON"))).toBe(false);
  });
});

describe("isUndoRedoChord", () => {
  const chord = (over: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; key: string }>) => ({
    metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: "z", ...over,
  });
  it("matches Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z and Cmd/Ctrl+Y", () => {
    expect(isUndoRedoChord(chord({ metaKey: true, key: "z" }))).toBe(true);
    expect(isUndoRedoChord(chord({ ctrlKey: true, key: "Z" }))).toBe(true);
    expect(isUndoRedoChord(chord({ metaKey: true, shiftKey: true, key: "z" }))).toBe(true);
    expect(isUndoRedoChord(chord({ metaKey: true, key: "y" }))).toBe(true);
  });
  it("rejects the chord without a modifier, with Alt, or for another key", () => {
    expect(isUndoRedoChord(chord({ key: "z" }))).toBe(false);
    expect(isUndoRedoChord(chord({ metaKey: true, altKey: true, key: "z" }))).toBe(false);
    expect(isUndoRedoChord(chord({ metaKey: true, key: "x" }))).toBe(false);
  });
});
