import { describe, expect, it } from "vitest";
// The helper is plain JavaScript; these tests pin the parts of its yt-dlp refresh that
// decide whether a download is accepted, without touching the network.
import { binaryAssetName, checksumFor, isCurrent, sha256 } from "../../server/youtube/update.mjs";

const UNIX = "a".repeat(64);
const MAC = "b".repeat(64);
const SUMS = [
  `${UNIX}  yt-dlp`,
  `${MAC} *yt-dlp_macos`,
  `${"c".repeat(64)}  yt-dlp.exe`,
  "",
].join("\n");

describe("binaryAssetName", () => {
  it("picks the Unix zipapp for the platforms the helper runs on", () => {
    expect(binaryAssetName("linux")).toBe("yt-dlp");
    expect(binaryAssetName("darwin")).toBe("yt-dlp");
  });

  it("has no build for anything else, so start-up leaves the binary alone", () => {
    expect(binaryAssetName("win32")).toBeNull();
  });
});

describe("isCurrent", () => {
  it("matches the version yt-dlp prints against the release tag", () => {
    expect(isCurrent("2026.10.29.232701\n", "2026.10.29.232701")).toBe(true);
    expect(isCurrent("2026.10.10.233141", "2026.10.29.232701")).toBe(false);
  });

  it("never treats an empty version or tag as current", () => {
    expect(isCurrent("", "2026.10.29.232701")).toBe(false);
    expect(isCurrent("2026.10.29.232701", "")).toBe(false);
  });
});

describe("checksumFor", () => {
  it("finds the line for the file, with or without the binary marker", () => {
    expect(checksumFor(SUMS, "yt-dlp")).toBe(UNIX);
    expect(checksumFor(SUMS, "yt-dlp_macos")).toBe(MAC);
  });

  it("reads CRLF line ends and the trailing newline", () => {
    expect(checksumFor(SUMS.replace(/\n/g, "\r\n"), "yt-dlp")).toBe(UNIX);
  });

  it("returns null when the file is not listed", () => {
    expect(checksumFor(SUMS, "yt-dlp_linux")).toBeNull();
    expect(checksumFor("", "yt-dlp")).toBeNull();
  });
});

describe("sha256", () => {
  it("is the lowercase hex digest of the buffer", () => {
    expect(sha256(Buffer.from("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});
