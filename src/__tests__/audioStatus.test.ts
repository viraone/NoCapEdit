import { describe, expect, it } from "vitest";
import { audioStatusFor } from "@/lib/media/audioStatus";

describe("audioStatusFor", () => {
  it("records a decoded audio track as ok", () => {
    expect(audioStatusFor({ decoded: true })).toBe("ok");
  });

  it("calls a picture made into a silent video none", () => {
    expect(audioStatusFor({ still: true, decoded: false, containerHasAudio: true })).toBe("none");
  });

  it("keeps assuming sound when the file was too big to decode", () => {
    expect(audioStatusFor({ skipped: true })).toBe("ok");
  });

  it("calls a failed decode of a declared audio track failed", () => {
    expect(audioStatusFor({ decoded: false, containerHasAudio: true })).toBe("failed");
  });

  it("calls an empty decode of a file with no audio track none", () => {
    expect(audioStatusFor({ decoded: false, containerHasAudio: false })).toBe("none");
  });

  it("keeps the old quiet answer when the container could not be read", () => {
    expect(audioStatusFor({ decoded: false, containerHasAudio: null })).toBe("none");
    expect(audioStatusFor({ decoded: false })).toBe("none");
  });
});
