import { describe, expect, it } from "vitest";
import { AUDIO_BITRATE, STREAMING_THRESHOLD_BYTES, estimatedVideoBitrate, shouldStream } from "@/lib/mobile/exportBudget";

describe("estimatedVideoBitrate", () => {
  it("uses 0.1 bits per pixel per second inside the 2.5–12 Mbps clamp", () => {
    expect(estimatedVideoBitrate(1920, 1080)).toBe(6_220_800);
    expect(estimatedVideoBitrate(320, 240)).toBe(2_500_000);
    expect(estimatedVideoBitrate(3840, 2160)).toBe(12_000_000);
  });
});

describe("shouldStream", () => {
  it("keeps a short 1080p clip in memory", () => {
    expect(shouldStream(30, 1920, 1080)).toBe(false);
  });

  it("streams a long 1080p clip", () => {
    expect(shouldStream(120, 1920, 1080)).toBe(true);
  });

  it("streams 4K once the estimated file passes 64 MB", () => {
    expect(shouldStream(20, 3840, 2160)).toBe(false);
    expect(shouldStream(60, 3840, 2160)).toBe(true);
  });

  it("takes an explicit bitrate when one is known", () => {
    expect(shouldStream(60, 1920, 1080, 20_000_000)).toBe(true);
    expect(shouldStream(60, 1920, 1080, 1_000_000)).toBe(false);
  });

  it("says no when there is nothing to export", () => {
    expect(shouldStream(0, 1920, 1080)).toBe(false);
    expect(shouldStream(-5, 1920, 1080)).toBe(false);
    expect(shouldStream(60, 0, 0)).toBe(false);
    expect(shouldStream(Number.NaN, 1920, 1080)).toBe(false);
  });

  it("crosses at the 64 MB estimate", () => {
    // A tiny clip sits on the 2.5 Mbps floor, so the crossing point is exact.
    const seconds = STREAMING_THRESHOLD_BYTES / ((2_500_000 + AUDIO_BITRATE) / 8);
    expect(shouldStream(seconds - 1, 320, 240)).toBe(false);
    expect(shouldStream(seconds + 1, 320, 240)).toBe(true);
  });
});
