import { describe, expect, it } from "vitest";
import { EXPORT_EXTENSIONS, safeExportName, numberedName, partName } from "../../desktop/lib/exportFolder.mjs";

describe("EXPORT_EXTENSIONS", () => {
  it("contains expected extensions", () => {
    expect(EXPORT_EXTENSIONS).toEqual([
      ".mp4",
      ".webm",
      ".mov",
      ".gif",
      ".png",
      ".srt",
      ".vtt",
      ".txt",
      ".zip",
    ]);
  });
});

describe("safeExportName", () => {
  it("returns null for non-string inputs", () => {
    expect(safeExportName(123)).toBeNull();
    expect(safeExportName(null)).toBeNull();
    expect(safeExportName(undefined)).toBeNull();
    expect(safeExportName({})).toBeNull();
  });

  it("returns null for names longer than 200 characters", () => {
    const longName = "a".repeat(196) + ".mp4";
    expect(safeExportName(longName)).toBe(longName);
    const tooLong = "a".repeat(197) + ".mp4";
    expect(safeExportName(tooLong)).toBeNull();
  });

  it("returns null for names containing slashes", () => {
    expect(safeExportName("../x.mp4")).toBeNull();
    expect(safeExportName("a/b.mp4")).toBeNull();
    expect(safeExportName("a\\b.mp4")).toBeNull();
  });

  it("returns null for names with control characters", () => {
    expect(safeExportName("a\nb.mp4")).toBeNull();
    expect(safeExportName("a\tb.mp4")).toBeNull();
    expect(safeExportName("a\x00b.mp4")).toBeNull();
    expect(safeExportName("a\x7fb.mp4")).toBeNull();
  });

  it("returns null for names starting with a dot", () => {
    expect(safeExportName(".hidden.mp4")).toBeNull();
  });

  it("returns null for names with leading or trailing spaces", () => {
    expect(safeExportName(" x.mp4")).toBeNull();
    expect(safeExportName("x.mp4 ")).toBeNull();
  });

  it("returns null for names without a valid extension", () => {
    expect(safeExportName("run.command")).toBeNull();
  });

  it("returns null for names with no stem before extension", () => {
    expect(safeExportName(".mp4")).toBeNull();
  });

  it("accepts valid names", () => {
    expect(safeExportName("video.mp4")).toBe("video.mp4");
    expect(safeExportName("X.MP4")).toBe("X.MP4");
    expect(safeExportName("a.b timeline.zip")).toBe("a.b timeline.zip");
  });
});

describe("numberedName", () => {
  it("returns original name when n <= 1", () => {
    expect(numberedName("My reel.mp4", 1)).toBe("My reel.mp4");
    expect(numberedName("My reel.mp4", 0)).toBe("My reel.mp4");
    expect(numberedName("My reel.mp4", -1)).toBe("My reel.mp4");
  });

  it("inserts number before extension", () => {
    expect(numberedName("My reel.mp4", 2)).toBe("My reel (2).mp4");
    expect(numberedName("a.b timeline.zip", 3)).toBe("a.b timeline (3).zip");
  });

  it("handles names without extension", () => {
    expect(numberedName("noext", 2)).toBe("noext (2)");
  });
});

describe("partName", () => {
  it("formats correctly", () => {
    expect(partName("video.mp4", "abc123")).toBe(".video.mp4.abc123.part");
  });
});
