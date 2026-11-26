export const COVER_FRAMES = 8;
export const DARK_BRIGHTNESS = 18;

export function sampleTimes(duration: number, count: number = COVER_FRAMES): number[] {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  let c = count;
  if (!Number.isFinite(c)) c = COVER_FRAMES;
  c = Math.floor(c);
  c = Math.max(1, Math.min(10, c));
  const out: number[] = [];
  for (let i = 0; i < c; i++) {
    out.push(Math.round(((i + 0.5) * duration) / c * 1000) / 1000);
  }
  return out;
}

export function brightness(rgba: Uint8Array | Uint8ClampedArray): number {
  const pixelCount = Math.floor(rgba.length / 4);
  if (pixelCount === 0) return 0;
  let sum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const r = rgba[i * 4];
    const g = rgba[i * 4 + 1];
    const b = rgba[i * 4 + 2];
    sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return sum / pixelCount;
}

export function candidates<T extends { brightness: number }>(frames: T[]): T[] {
  if (frames.length === 0) return [];
  const bright = frames.filter((f) => f.brightness >= DARK_BRIGHTNESS);
  if (bright.length > 0) return bright;
  let best = frames[0];
  for (let i = 1; i < frames.length; i++) {
    if (frames[i].brightness > best.brightness) best = frames[i];
  }
  return [best];
}

export function squareCrop(width: number, height: number, center: number): { x: number; y: number; size: number } {
  const size = Math.round(Math.min(width, height));
  let c = center;
  if (!Number.isFinite(c)) c = 0.5;
  c = Math.max(0, Math.min(1, c));

  let x = 0;
  let y = 0;

  if (height > width) {
    // Longer side is vertical
    const maxOffset = height - size;
    const idealCenter = c * height;
    y = Math.round(idealCenter - size / 2);
    y = Math.max(0, Math.min(maxOffset, y));
  } else if (width > height) {
    // Longer side is horizontal
    const maxOffset = width - size;
    const idealCenter = c * width;
    x = Math.round(idealCenter - size / 2);
    x = Math.max(0, Math.min(maxOffset, x));
  } else {
    // Square image, center doesn't matter, offset is 0
    x = 0;
    y = 0;
  }

  return { x, y, size };
}
