/**
 * Decides whether the global Space shortcut (play/pause) should fire, or
 * whether Space belongs to the focused control instead (a native button,
 * switch, tile or the tool rail all activate on Space the way a browser
 * button does).
 *
 * The two conventions the suite pins:
 *  - a control focused by the KEYBOARD (Tab, or scripted .focus()) gets
 *    Space: it activates like a native <button>, and playback is untouched.
 *  - a control focused by a POINTER click keeps today's behaviour: Space
 *    always toggles playback, and does not re-fire the clicked control.
 * The distinction is "was this element's focus the result of a pointer
 * press", tracked from pointerdown/focusin/focusout, not CSS :focus-visible
 * (Chromium sets that flag on the very keydown we are handling).
 */

export const ACTIVATABLE_SELECTOR = 'button, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], a[href], summary';

interface ElementLike {
  closest?: (selector: string) => unknown;
}

/** Whether Space on this target is a native (or emulated) activation, not the play/pause shortcut. */
export function isActivatableTarget(target: EventTarget | null): boolean {
  const el = target as ElementLike | null;
  return !!el?.closest?.(ACTIVATABLE_SELECTOR);
}

export interface FocusModality {
  pointerDown(): void;
  pointerUp(): void;
  focusIn(): void;
  focusOut(): void;
  tab(): void;
  isPointerFocused(): boolean;
}

/** Tracks whether the currently focused element got there from a pointer press. DOM-free so it can be unit-tested. */
export function createFocusModality(): FocusModality {
  let pressing = false;
  let pointerFocused = false;
  return {
    pointerDown() {
      pressing = true;
      // A click on an already-focused control fires no focusin, so mark it here too.
      pointerFocused = true;
    },
    pointerUp() {
      pressing = false;
    },
    focusIn() {
      // A pointer press typically focuses its target between pointerdown and pointerup.
      pointerFocused = pressing;
    },
    focusOut() {
      pointerFocused = false;
    },
    tab() {
      pressing = false;
    },
    isPointerFocused: () => pointerFocused,
  };
}
