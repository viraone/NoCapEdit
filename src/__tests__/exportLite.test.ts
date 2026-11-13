import { describe, expect, it } from "vitest";
import { aacSpecificConfig, checkLiteSupport, outputSize, safeDuration } from "@/lib/mobile/exportLite";

function chunk(duration: number | null | undefined): EncodedVideoChunk {
  return { duration } as unknown as EncodedVideoChunk;
}

describe("lite export output size", () => {
  it("caps the long edge and never upscales a small source", () => {
    expect(outputSize(3840, 2160, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(1280, 720, 1920)).toEqual({ width: 1280, height: 720 });
    expect(outputSize(1080, 1920, 1080)).toEqual({ width: 608, height: 1080 });
  });

  it("keeps both sides even", () => {
    expect(outputSize(1919, 1079, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(outputSize(3, 5, 1920)).toEqual({ width: 4, height: 6 });
  });

  it("never returns a zero or negative side for degenerate input", () => {
    expect(outputSize(0, 0, 1920)).toEqual({ width: 2, height: 2 });

    const negative = outputSize(-1920, 1080, 1920);
    expect(negative.width).toBeGreaterThan(0);
    expect(negative.height).toBeGreaterThan(0);

    const huge = outputSize(Number.MAX_SAFE_INTEGER, 1, 1920);
    expect(huge).toEqual({ width: 1920, height: 2 });
  });
});

describe("lite export AAC config", () => {
  it("builds the 2-byte AAC-LC AudioSpecificConfig", () => {
    expect([...aacSpecificConfig(48000, 2)]).toEqual([0x11, 0x90]);
    expect([...aacSpecificConfig(44100, 1)]).toEqual([0x12, 0x08]);
    expect([...aacSpecificConfig(96000, 2)]).toEqual([0x10, 0x10]);
  });

  it("rejects a sample rate AAC-LC cannot express", () => {
    expect(() => aacSpecificConfig(44000, 2)).toThrow("Unsupported AAC sample rate 44000");
    expect(() => aacSpecificConfig(0, 1)).toThrow("Unsupported AAC sample rate 0");
    expect(() => aacSpecificConfig(-48000, 2)).toThrow("Unsupported AAC sample rate -48000");
  });
});

describe("lite export chunk duration", () => {
  it("keeps a finite, non-negative duration", () => {
    expect(safeDuration(chunk(33333), 40000)).toBe(33333);
    expect(safeDuration(chunk(0), 40000)).toBe(0);
  });

  it("falls back when Safari reports a missing or unusable duration", () => {
    for (const bad of [null, undefined, Number.NaN, -1, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(safeDuration(chunk(bad), 40000)).toBe(40000);
    }
  });
});

describe("lite export support", () => {
  it("reports no support outside a browser", async () => {
    await expect(checkLiteSupport()).resolves.toEqual({ ok: false, reason: "No window", audioEncoder: false });
  });
});
