export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const round = (v: number, decimals = 2) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
/** Rounds to an even integer (video codecs need even dimensions). */
export const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
