/** The Post / Reel window's remembered choices, and what the phone cannot type. */

export interface ReelChoices {
  keepFull: boolean;
  next: boolean;
  share: boolean;
  location: string;
}

const KEY = "reelflow.reelChoices";
const DEFAULTS: ReelChoices = { keepFull: true, next: true, share: true, location: "" };

/** Reads saved choices from their stored text; anything missing or wrong falls back to the default (all ticked). */
export function parseReelChoices(text: string | null): ReelChoices {
  if (!text) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return { ...DEFAULTS };
    const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    return {
      keepFull: flag(raw.keepFull, DEFAULTS.keepFull),
      next: flag(raw.next, DEFAULTS.next),
      share: flag(raw.share, DEFAULTS.share),
      location: typeof raw.location === "string" ? raw.location.slice(0, 80) : "",
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function loadReelChoices(): ReelChoices {
  try {
    return parseReelChoices(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY));
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveReelChoices(choices: ReelChoices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choices));
  } catch {
    // private window or storage blocked: the choices just are not remembered
  }
}

/** Characters the phone types as a plain one instead (curly quotes, long dashes ...). Kept in step with desktop/lib/phone.mjs. */
const SWAPPED = "‘’“”–—… ";

/**
 * The characters in `text` the phone cannot type (emoji, accents): the emulator's typing tool
 * takes plain keyboard characters only. Each is listed once.
 */
export function untypeable(text: string): string[] {
  const found: string[] = [];
  for (const ch of text) {
    if (ch === "\n" || ch === "\r" || SWAPPED.includes(ch) || /^[\x20-\x7e]$/.test(ch)) continue;
    if (!found.includes(ch)) found.push(ch);
  }
  return found;
}

/** A line to show under the caption box when some of it will be left out, else null. */
export function typeableNote(text: string): string | null {
  const bad = untypeable(text);
  if (!bad.length) return null;
  return `The phone can only type plain keyboard characters, so these will be left out: ${bad.slice(0, 12).join(" ")}. Add them in the phone panel before sharing.`;
}
