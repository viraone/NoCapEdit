import { describe, expect, it } from "vitest";
import { parseWav, resampleLinear } from "@/lib/mobile/audio";

/** Builds a 16-bit PCM WAV in memory. */
function makeWav(sampleRate: number, channels: Float32Array[]): Uint8Array {
  const n = channels[0].length;
  const numChannels = channels.length;
  const dataLen = n * numChannels * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + dataLen, true); w(8, "WAVE");
  w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * numChannels * 2, true);
  v.setUint16(32, numChannels * 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, dataLen, true);
  let p = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < numChannels; c++) { v.setInt16(p, Math.round(channels[c][i] * 32767), true); p += 2; }
  return new Uint8Array(buf);
}

describe("mobile audio", () => {
  it("parses a stereo 16-bit WAV back into planar floats", () => {
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([1, -1, 0.25, 0]);
    const parsed = parseWav(makeWav(48000, [left, right]));
    expect(parsed.sampleRate).toBe(48000);
    expect(parsed.channels).toHaveLength(2);
    expect(Array.from(parsed.channels[0]).map((x) => +x.toFixed(2))).toEqual([0, 0.5, -0.5, 1]);
    expect(Array.from(parsed.channels[1]).map((x) => +x.toFixed(2))).toEqual([1, -1, 0.25, 0]);
  });

  it("rejects non-WAV bytes", () => {
    expect(() => parseWav(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow();
  });

  it("resamples 48 kHz to 16 kHz by a third", () => {
    const input = new Float32Array(48000).map((_, i) => Math.sin(i / 10));
    const out = resampleLinear(input, 48000, 16000);
    expect(out.length).toBe(16000);
    expect(out[0]).toBeCloseTo(input[0], 5);
    expect(out[100]).toBeCloseTo(input[300], 2);
  });
});
