/**
 * Focus-trap mechanics for Modal: finding a dialog's focusable descendants
 * and deciding where Tab/Shift+Tab should wrap. The DOM query and the pure
 * decision are split apart so the decision can be unit-tested without a DOM.
 */

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Focusable, visible descendants of `root`, in DOM (tab) order. */
export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.getClientRects().length > 0);
}

/**
 * Given `count` focusable elements and the index of the currently active one
 * (-1 when focus is outside the list), decides where Tab/Shift+Tab should
 * land: "first" or "last" to wrap, or null to let the browser move focus
 * normally within the list.
 */
export function cycleTarget(count: number, activeIndex: number, backwards: boolean): "first" | "last" | null {
  if (count === 0) return null;
  if (backwards) return activeIndex <= 0 ? "last" : null;
  return activeIndex === -1 || activeIndex === count - 1 ? "first" : null;
}
