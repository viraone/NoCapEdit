export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Parses a number input's draft text. Returns null for a cleared field and
 * for anything the browser itself could not parse (badInput, e.g. "-", "1e",
 * "1e999" on a type=number input all report value="" with validity.badInput
 * true) so the caller can revert instead of committing Number("") === 0.
 */
export function parseNumberDraft(raw: string, badInput = false): number | null {
  if (badInput) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
/** Rounds to an even integer (video codecs need even dimensions). */
export const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
