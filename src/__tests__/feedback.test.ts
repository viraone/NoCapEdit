import { describe, expect, it, vi } from "vitest";
import { findFeedbackTones, notchFilters, notchQ, MAX_NOTCHES } from "@/lib/audio/feedback";

const SR = 16000;

// The synthetic signals take a moment to build and scan; a shared CI machine can be several times slower than a laptop.
vi.setConfig({ testTimeout: 60_000 });

/** Small seeded generator so the tests are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Voice-like signal: a pitch that wanders between syllables (harmonics up to 4 kHz), with pauses, plus a little noise. */
function speech(seconds: number, seed = 1): Float32Array {
  const rand = rng(seed);
  const out = new Float32Array(Math.round(seconds * SR));
  let f0 = 140;
  let phase = 0;
  let t = 0;
  while (t < seconds) {
    const len = 0.18 + rand() * 0.25;
    const pause = rand() < 0.25;
    const target = 95 + rand() * 150;
    for (let i = 0; i < Math.floor(len * SR) && t + i / SR < seconds; i++) {
      const idx = Math.floor(t * SR) + i;
      f0 += (target - f0) * 0.0004 + (rand() - 0.5) * 0.15;
      phase += (2 * Math.PI * f0) / SR;
      const env = Math.sin((Math.PI * i) / (len * SR)) ** 0.7;
      let v = 0;
      for (let h = 1; h * f0 < 4000; h++) v += Math.sin(h * phase) / h ** 1.1;
      out[idx] += pause ? (rand() - 0.5) * 0.004 : 0.12 * env * v;
    }
    t += len;
  }
  for (let i = 0; i < out.length; i++) out[i] += (rand() - 0.5) * 0.004;
  return out;
}

function addTone(x: Float32Array, freq: number, amp: number, from = 0, to = x.length / SR) {
  for (let i = Math.floor(from * SR); i < Math.min(x.length, Math.floor(to * SR)); i++) x[i] += amp * Math.sin((2 * Math.PI * freq * i) / SR);
}

describe("findFeedbackTones", () => {
  it("finds a steady tone under speech, within a few Hz", async () => {
    const x = speech(40);
    addTone(x, 2812.5, 0.05);
    const tones = await findFeedbackTones(x, SR);
    expect(tones.length).toBe(1);
    expect(Math.abs(tones[0].freq - 2812.5)).toBeLessThan(3);
    expect(tones[0].share).toBeGreaterThan(0.8);
  });

  it("finds several tones, strongest share first", async () => {
    const x = speech(40, 7);
    addTone(x, 1990, 0.05);
    addTone(x, 5310.4, 0.04);
    addTone(x, 920, 0.05, 0, 20); // rings for half the clip only
    const tones = await findFeedbackTones(x, SR);
    expect(tones.length).toBe(3);
    for (const want of [1990, 5310.4, 920]) expect(tones.some((t) => Math.abs(t.freq - want) < 3)).toBe(true);
    expect(tones[tones.length - 1].freq).toBeCloseTo(920, -1);
    for (let i = 1; i < tones.length; i++) expect(tones[i - 1].share).toBeGreaterThanOrEqual(tones[i].share);
  });

  it("reports nothing for speech alone, however its pitch moves", async () => {
    for (const seed of [1, 2, 3, 4, 5]) expect(await findFeedbackTones(speech(40, seed), SR)).toEqual([]);
  }, 30000);

  it("reports nothing for plain noise", async () => {
    const rand = rng(99);
    const x = new Float32Array(30 * SR).map(() => (rand() - 0.5) * 0.2);
    expect(await findFeedbackTones(x, SR)).toEqual([]);
  });

  it("ignores mains hum below the scan range", async () => {
    const x = speech(30);
    addTone(x, 60, 0.1);
    addTone(x, 120, 0.05);
    expect(await findFeedbackTones(x, SR)).toEqual([]);
  });

  it("needs real audio: silence and very short clips give nothing", async () => {
    expect(await findFeedbackTones(new Float32Array(20 * SR), SR)).toEqual([]);
    const short = speech(0.4);
    addTone(short, 2000, 0.1);
    expect(await findFeedbackTones(short, SR)).toEqual([]);
  });

  it("only scans the asked-for range", async () => {
    const x = speech(40);
    addTone(x, 3300, 0.06, 20, 40); // rings in the second half only
    expect(await findFeedbackTones(x, SR, { from: 0, to: 20 })).toEqual([]);
    const found = await findFeedbackTones(x, SR, { from: 20, to: 40 });
    expect(found.length).toBe(1);
    expect(Math.abs(found[0].freq - 3300)).toBeLessThan(3);
  });

  it("can be cancelled", async () => {
    const x = speech(10);
    const c = new AbortController();
    c.abort();
    await expect(findFeedbackTones(x, SR, { signal: c.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("never returns more tones than the preview has filters", async () => {
    const x = speech(40);
    for (const f of [700, 1300, 1900, 2500, 3100, 3700, 4300, 4900]) addTone(x, f, 0.03);
    expect((await findFeedbackTones(x, SR)).length).toBeLessThanOrEqual(MAX_NOTCHES);
  });
});

describe("notches", () => {
  it("is about 80 Hz wide, within sane limits", () => {
    expect(notchQ(3200)).toBe(40);
    expect(notchQ(800)).toBe(10);
    expect(notchQ(200)).toBe(8);
    expect(notchQ(9000)).toBe(40);
  });

  it("builds one ffmpeg bandreject per tone, and nothing for none", () => {
    expect(notchFilters(undefined)).toEqual([]);
    expect(notchFilters([])).toEqual([]);
    expect(notchFilters([2812.5, 5940])).toEqual(["bandreject=f=2812.5:width_type=q:w=35.16", "bandreject=f=5940.0:width_type=q:w=40"]);
    expect(notchFilters([NaN, 5, 30000, 1000])).toEqual(["bandreject=f=1000.0:width_type=q:w=12.5"]);
  });
});
