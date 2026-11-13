import { describe, expect, it } from "vitest";
import { CANCELLED_EXPORT_ERROR, UNKNOWN_EXPORT_ERROR, friendlyExportError } from "@/lib/export/friendlyError";

function named(name: string, message: string): Error {
  return Object.assign(new Error(message), { name });
}

describe("friendlyExportError", () => {
  it("explains a missing H.264 encoder configuration for the size", () => {
    expect(friendlyExportError(new Error("No supported H.264 encoder configuration for this size."))).toBe(
      "This device can't encode video at this size. Pick a smaller size and try again.",
    );
  });

  it("explains running out of memory, including emscripten's Aborted(OOM)", () => {
    for (const err of [new Error("Aborted(OOM)"), named("RangeError", "Array buffer allocation failed"), new Error("RuntimeError: out of memory")]) {
      expect(friendlyExportError(err)).toMatch(/ran out of memory/);
      expect(friendlyExportError(err)).toMatch(/smaller size/);
    }
  });

  it("explains a full disk", () => {
    expect(friendlyExportError(named("QuotaExceededError", "The quota has been exceeded."))).toMatch(/storage/);
    expect(friendlyExportError(new Error("No space left on device"))).toMatch(/storage/);
    expect(friendlyExportError(new Error("ENOSPC: disk is full"))).toMatch(/storage/);
  });

  it("explains a browser without WebCodecs", () => {
    expect(friendlyExportError(new Error("WebCodecs is not available in this browser"))).toMatch(/browser can't encode video/);
    expect(friendlyExportError(new Error("This browser cannot capture video frames (requestVideoFrameCallback)."))).toMatch(/browser can't encode video/);
  });

  it("explains a video the browser could not decode", () => {
    expect(friendlyExportError(new Error("This video could not be decoded by your browser."))).toMatch(/couldn't be read/);
    expect(friendlyExportError(named("NotSupportedError", "The element has no supported sources."))).toMatch(/couldn't be read/);
  });

  it("calls a cancellation what it is", () => {
    expect(friendlyExportError(named("AbortError", "Export cancelled"))).toBe(CANCELLED_EXPORT_ERROR);
  });

  it("keeps a message already written for people", () => {
    const message = "Couldn't hear any speech in this video.";
    expect(friendlyExportError(new Error(message))).toBe(message);
  });

  it("gives a generic sentence and something to try for anything else", () => {
    for (const err of [new Error("x is not a function"), "boom", null, undefined, 42]) {
      expect(friendlyExportError(err)).toBe(UNKNOWN_EXPORT_ERROR);
    }
  });
});
