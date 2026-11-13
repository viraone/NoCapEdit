/**
 * The editor's global keyboard map, decided in one pure function so the whole
 * map can be pinned by tests without a DOM.
 *
 * The target guards are the ones from keyTargets (EditorShell used them inline
 * before): a text field, textarea or contentEditable keeps every key, so
 * Cmd/Ctrl+Z stays the browser's native undo there; the other native controls
 * (a select, a range slider, a checkbox) keep their keys too, except the
 * undo/redo chord, which is the editor's everywhere.
 *
 * The "Space belongs to a focused control" decision is deliberately not here:
 * it needs the focus-modality tracker, so EditorShell applies it after this
 * function answers "play-pause".
 */
import { isNativeKeyOwner, isTextEntryTarget, isUndoRedoChord } from "@/components/editor/keyTargets";

export type ShortcutAction =
  | "play-pause"
  | "split-at-playhead"
  | "undo"
  | "redo"
  | "remove-selection"
  | "seek-back"
  | "seek-forward"
  | "seek-start"
  | "seek-end"
  | "clear-selection"
  | "zoom-in"
  | "zoom-out";

/** The parts of a KeyboardEvent this map reads. */
export interface ShortcutEvent {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  /** Set when another handler already claimed the key (e.g. a focused button's own Space). */
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}

/** The action a keydown means, or null when the key is not an editor shortcut. */
export function shortcutFor(e: ShortcutEvent): ShortcutAction | null {
  // Text entry owns every key, including Cmd+Z.
  if (isTextEntryTarget(e.target ?? null)) return null;
  // Other native controls own their keys, except undo/redo, which is the editor's.
  if (isNativeKeyOwner(e.target ?? null) && !isUndoRedoChord(e)) return null;

  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.toLowerCase();

  // Space: `code` is the reliable field, `key` (a plain space) covers synthetic events.
  if (e.code === "Space" || key === " ") {
    if (e.defaultPrevented) return null;
    return "play-pause";
  }
  // S, or Cmd/Ctrl+B (the old shortcut), splits at the playhead.
  if (key === "s" && !mod && !e.altKey) return "split-at-playhead";
  if (mod && key === "b") return "split-at-playhead";
  if (mod && key === "z") return e.shiftKey ? "redo" : "undo";
  if (mod && key === "y") return "redo";
  if (key === "delete" || key === "backspace") return "remove-selection";
  if (key === "arrowleft") return "seek-back";
  if (key === "arrowright") return "seek-forward";
  if (key === "home") return "seek-start";
  if (key === "end") return "seek-end";
  if (key === "escape") return "clear-selection";
  // Same step as the timeline's Zoom buttons. "=" is "+" without Shift on a US layout.
  if (!e.altKey && (key === "+" || key === "=")) return "zoom-in";
  if (!e.altKey && (key === "-" || key === "_")) return "zoom-out";
  return null;
}
