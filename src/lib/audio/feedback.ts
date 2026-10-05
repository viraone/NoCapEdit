/**
 * Mic feedback finder. Feedback is a narrow tone that sits at one frequency for
 * a long stretch; speech moves around, so a frequency that is a sharp spectral
 * peak in a large share of the loud frames is ringing, not a voice. The tones
 * found are removed with narrow notch filters, in the live preview (Web Audio)
 * and in the export (ffmpeg bandreject), see notchQ and notchFilters.
 */

export interface FeedbackTone {
  /** Centre frequency in Hz. */
  freq: number;
  /** Share of the loud frames in which this tone was a sharp peak (0..1). */
  share: number;
}

export interface FeedbackScanOptions {
  /** Part of the samples to scan, in seconds. */
  from?: number;
  to?: number;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}

const FFT = 4096;
const HOP = 2048;
const MIN_HZ = 150;
const MAX_HZ = 7800;
/** Frames quieter than this (RMS) are silence, where a noise floor would look like noise, not ringing. */
const SILENCE_RMS = 0.0025;
/** A peak must stand this far (dB) above the spectrum around it. */
const PROMINENCE_DB = 14;
/** Bins either side of a peak that count as "around it", and the bins skipped next to it (its own main lobe). */
const SIDE = 10;
const LOBE = 2;
/** Share of loud frames a tone must ring in to count. */
const MIN_SHARE = 0.35;
/** At most this many tones are returned (the playback chain has this many notch filters). */
export const MAX_NOTCHES = 6;
/** Tones closer than this (Hz) are one tone. */
const MERGE_HZ = 40;
const MIN_LOUD_FRAMES = 8;

/** In-place radix-2 FFT of `re`/`im` (length a power of two). */
function fft(re: Float64Array, im: Float64Array, rev: Uint32Array, cos: Float64Array, sin: Float64Array) {
  const n = re.length;
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, t = 0; k < half; k++, t += step) {
        const a = start + k;
        const b = a + half;
        const xr = re[b] * cos[t] + im[b] * sin[t];
        const xi = im[b] * cos[t] - re[b] * sin[t];
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

function tables() {
  const rev = new Uint32Array(FFT);
  const bits = Math.log2(FFT);
  for (let i = 0; i < FFT; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  const cos = new Float64Array(FFT / 2);
  const sin = new Float64Array(FFT / 2);
  for (let i = 0; i < FFT / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / FFT);
    sin[i] = Math.sin((2 * Math.PI * i) / FFT);
  }
  const hann = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1));
  return { rev, cos, sin, hann };
}

/** Finds steady narrow tones in mono `samples`; strongest first, at most MAX_NOTCHES. */
export async function findFeedbackTones(samples: Float32Array, sampleRate: number, o: FeedbackScanOptions = {}): Promise<FeedbackTone[]> {
  const start = Math.max(0, Math.floor((o.from ?? 0) * sampleRate));
  const end = Math.min(samples.length, Math.floor((o.to ?? samples.length / sampleRate) * sampleRate));
  const { rev, cos, sin, hann } = tables();
  const bins = FFT / 2;
  const binHz = sampleRate / FFT;
  const kMin = Math.max(LOBE + SIDE + 1, Math.ceil(MIN_HZ / binHz));
  const kMax = Math.min(bins - SIDE - 2, Math.floor(Math.min(MAX_HZ, sampleRate / 2 - 200) / binHz));
  const hits = new Float64Array(bins);
  const avgDb = new Float64Array(bins);
  const re = new Float64Array(FFT);
  const im = new Float64Array(FFT);
  const power = new Float64Array(bins);
  const prefix = new Float64Array(bins + 1);
  const total = Math.max(1, Math.floor((end - start - FFT) / HOP) + 1);
  const ratio = 10 ** (PROMINENCE_DB / 10);
  let loud = 0;
  let frame = 0;

  for (let pos = start; pos + FFT <= end; pos += HOP, frame++) {
    if (frame % 150 === 0) {
      if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      o.onProgress?.(frame / total);
      // Hand the thread back so the page stays responsive during a long scan.
      await new Promise((r) => setTimeout(r, 0));
    }
    let sum = 0;
    for (let i = 0; i < FFT; i++) {
      const v = samples[pos + i];
      sum += v * v;
    }
    if (Math.sqrt(sum / FFT) < SILENCE_RMS) continue;
    loud++;
    for (let i = 0; i < FFT; i++) {
      re[i] = samples[pos + i] * hann[i];
      im[i] = 0;
    }
    fft(re, im, rev, cos, sin);
    for (let k = 0; k < bins; k++) {
      power[k] = re[k] * re[k] + im[k] * im[k];
      prefix[k + 1] = prefix[k] + power[k];
    }
    for (let k = kMin; k <= kMax; k++) {
      avgDb[k] += 10 * Math.log10(power[k] + 1e-12);
      if (power[k] > power[k - 1] && power[k] >= power[k + 1]) {
        const around = prefix[k + SIDE + 1] - prefix[k - SIDE] - (prefix[k + LOBE + 1] - prefix[k - LOBE]);
        const mean = around / (2 * SIDE + 1 - (2 * LOBE + 1));
        if (power[k] > mean * ratio) hits[k]++;
      }
    }
  }
  o.onProgress?.(1);
  if (loud < MIN_LOUD_FRAMES) return [];

  // A tone that falls between two bins flips between them from frame to frame: count the neighbours together.
  const share = new Float64Array(bins);
  for (let k = kMin; k <= kMax; k++) share[k] = (hits[k - 1] + hits[k] + hits[k + 1]) / loud;
  const order: number[] = [];
  for (let k = kMin; k <= kMax; k++) if (share[k] >= MIN_SHARE && share[k] >= share[k - 1] && share[k] >= share[k + 1]) order.push(k);
  order.sort((a, b) => share[b] - share[a]);

  const tones: FeedbackTone[] = [];
  for (const k0 of order) {
    // The loudest of the three bins on average is the tone's own bin; a parabola through them gives the frequency.
    let k = k0;
    if (avgDb[k0 - 1] > avgDb[k]) k = k0 - 1;
    if (avgDb[k0 + 1] > avgDb[k]) k = k0 + 1;
    const a = avgDb[k - 1];
    const b = avgDb[k];
    const c = avgDb[k + 1];
    const denom = a - 2 * b + c;
    const p = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
    const freq = (k + p) * binHz;
    if (tones.some((t) => Math.abs(t.freq - freq) < MERGE_HZ)) continue;
    tones.push({ freq: Math.round(freq * 10) / 10, share: Math.min(1, share[k0]) });
    if (tones.length >= MAX_NOTCHES) break;
  }
  return tones.sort((x, y) => y.share - x.share);
}

/** Notch quality factor for a tone: about 80 Hz wide, so a frequency estimate a few Hz off still lands inside it. */
export function notchQ(freq: number): number {
  return Math.round(Math.max(8, Math.min(40, freq / 80)) * 100) / 100;
}

/** ffmpeg audio filters that remove the given tones (empty when there are none). */
export function notchFilters(freqs: readonly number[] | null | undefined): string[] {
  return (freqs ?? []).slice(0, MAX_NOTCHES).filter((f) => Number.isFinite(f) && f > 20 && f < 20000).map((f) => `bandreject=f=${f.toFixed(1)}:width_type=q:w=${notchQ(f)}`);
}
