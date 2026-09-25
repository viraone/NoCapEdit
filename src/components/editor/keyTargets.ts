/**
 * Pure predicates over an event target, used by EditorShell's global keydown
 * handler. Split out so they can be unit-tested without a DOM (vitest runs in
 * the "node" environment): everything here reads only tagName/type/
 * isContentEditable, never layout or focus state.
 */

interface TargetLike {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

const TEXT_INPUT_TYPES = new Set(["text", "search", "url", "tel", "email", "password", "number", ""]);

/** INPUT, TEXTAREA, SELECT or contentEditable: every element with its own native key handling. */
export function isNativeKeyOwner(target: EventTarget | null): boolean {
  const el = target as TargetLike | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || !!el.isContentEditable;
}

/** A control the user can type free text or numbers into: everywhere Cmd+Z must stay the browser's native undo. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as TargetLike | null;
  if (!el) return false;
  if (el.tagName === "TEXTAREA" || el.isContentEditable) return true;
  if (el.tagName !== "INPUT") return false;
  return TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
}

/** Cmd+Z, Cmd+Shift+Z or Cmd+Y (Ctrl on Windows/Linux), with no other modifier. */
export function isUndoRedoChord(e: { metaKey: boolean; ctrlKey: boolean; altKey: boolean; key: string }): boolean {
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();
  return mod && !e.altKey && (key === "z" || key === "y");
}
