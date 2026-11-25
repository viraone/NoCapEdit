/** Sizing of the phone panel, which the user can drag wider (and so taller, over the timeline). */

export const PANEL_DEFAULT_WIDTH = 304;
export const PANEL_MIN_WIDTH = 240;
/** Header, button row, padding and borders around the picture, top to bottom. */
const CHROME_HEIGHT = 96;
/** Padding and borders either side of the picture. */
const CHROME_WIDTH = 18;
const KEY = "reelflow.phoneWidth";

/** The panel height that shows the whole phone screen at this panel width. */
export function panelHeightFor(width: number, phone: { width: number; height: number }): number {
  return Math.round(CHROME_HEIGHT + ((width - CHROME_WIDTH) * phone.height) / Math.max(1, phone.width));
}

/** The panel width at which the whole phone screen just fits this panel height (the inverse of panelHeightFor). */
export function panelWidthFor(height: number, phone: { width: number; height: number }): number {
  return Math.round(CHROME_WIDTH + ((height - CHROME_HEIGHT) * phone.width) / Math.max(1, phone.height));
}

/**
 * A dragged width held to what is useful: not narrower than the minimum, not wider than the
 * picture can use in the height there is, and never more than 60% of the window.
 */
export function clampPanelWidth(width: number, room: { height: number; windowWidth: number }, phone: { width: number; height: number }): number {
  const byHeight = CHROME_WIDTH + ((room.height - CHROME_HEIGHT) * phone.width) / Math.max(1, phone.height);
  const max = Math.max(PANEL_MIN_WIDTH, Math.min(byHeight, room.windowWidth * 0.6));
  return Math.round(Math.min(max, Math.max(PANEL_MIN_WIDTH, width)));
}

/** The width the user dragged the panel to, or null when they never did (the panel then fits its row). */
export function loadPanelWidth(): number | null {
  try {
    const n = Number(typeof localStorage === "undefined" ? NaN : (localStorage.getItem(KEY) ?? NaN));
    return Number.isFinite(n) && n >= PANEL_MIN_WIDTH && n <= 4000 ? n : null;
  } catch {
    return null;
  }
}

/** Remembers a dragged width; null forgets it. */
export function savePanelWidth(width: number | null): void {
  try {
    if (width === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(Math.round(width)));
  } catch {
    // storage blocked: the width just is not remembered
  }
}
