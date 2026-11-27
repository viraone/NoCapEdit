import { describe, expect, it } from "vitest";
import type { MusicTrack } from "@/lib/models/project";
import { bakedMusicName, shouldWarnBakedMusic } from "@/lib/phone/bakedMusic";

function track(overrides: Partial<MusicTrack> = {}): MusicTrack {
  return {
    assetId: "a",
    name: "Song",
    duration: 10,
    volume: 1,
    fadeIn: 0,
    fadeOut: 0,
    startOffset: 0,
    loop: false,
    ...overrides,
  };
}

describe("bakedMusicName", () => {
  it("returns the track name when from the project", () => {
    expect(bakedMusicName({ music: track({ name: "Timber" }) }, true)).toBe("Timber");
  });
  it("returns null when not from the project", () => {
    expect(bakedMusicName({ music: track({ name: "Timber" }) }, false)).toBeNull();
  });
  it("returns null when there is no project", () => {
    expect(bakedMusicName(null, true)).toBeNull();
    expect(bakedMusicName(undefined, true)).toBeNull();
    expect(bakedMusicName({ music: null }, true)).toBeNull();
  });
  it("returns null when the volume is 0", () => {
    expect(bakedMusicName({ music: track({ volume: 0 }) }, true)).toBeNull();
  });
  it("falls back to a generic name when the track name is blank", () => {
    expect(bakedMusicName({ music: track({ name: "   " }) }, true)).toBe("your music track");
  });
});

describe("shouldWarnBakedMusic", () => {
  it("warns when there is baked music, no song and not muted", () => {
    expect(shouldWarnBakedMusic("Timber", false, false)).toBe(true);
  });
  it("does not warn when a song is wanted", () => {
    expect(shouldWarnBakedMusic("Timber", true, false)).toBe(false);
  });
  it("does not warn when muted", () => {
    expect(shouldWarnBakedMusic("Timber", false, true)).toBe(false);
  });
  it("does not warn when there is no baked music", () => {
    expect(shouldWarnBakedMusic(null, false, false)).toBe(false);
  });
});
