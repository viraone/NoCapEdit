/**
 * Undo bookkeeping for one range input, kept pure so it can be unit-tested.
 *
 * A pointer drag or a run of keyboard nudges is one undo step. The gesture
 * owns the store transaction it opened and never closes one it did not open,
 * so a slider losing focus cannot discard the transaction another slider has
 * just started. Keyboard nudges in quick succession (key repeat, a burst of
 * taps) fold into one step; after a pause the next nudge starts a new one.
 */
export const NUDGE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
/** Nudges closer together than this (ms) share one undo step. */
export const KEY_COALESCE_MS = 250;

export interface SliderGesture {
  pointerDown(): void;
  pointerUp(): void;
  keyDown(key: string, modifier: boolean): void;
  keyUp(): void;
  blur(): void;
}

export function createSliderGesture(tx: { begin?: () => boolean | void; end?: () => boolean | void }, now: () => number = () => Date.now()): SliderGesture {
  let owns = false;
  /** A keyboard step has been recorded and later nudges still fold into it. */
  let keyboardStep = false;
  let lastKeyUp = 0;
  const begin = () => {
    if (owns || !tx.begin) return;
    // A void return (a handler that does not report) counts as owned.
    owns = tx.begin() !== false;
  };
  const end = () => {
    if (!owns) return false;
    owns = false;
    return tx.end?.() === true;
  };
  return {
    pointerDown() {
      keyboardStep = false;
      begin();
    },
    pointerUp() {
      end();
    },
    keyDown(key, modifier) {
      if (modifier) {
        // Cmd+Z and friends: the next nudge starts a fresh step.
        keyboardStep = false;
        return;
      }
      if (!NUDGE_KEYS.has(key)) return;
      if (keyboardStep && now() - lastKeyUp > KEY_COALESCE_MS) keyboardStep = false;
      if (keyboardStep) return;
      begin();
    },
    keyUp() {
      lastKeyUp = now();
      if (end()) keyboardStep = true;
    },
    blur() {
      end();
      keyboardStep = false;
    },
  };
}
