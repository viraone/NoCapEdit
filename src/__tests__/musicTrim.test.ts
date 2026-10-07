import { describe, expect, it } from "vitest";
import { MIN_MUSIC_SECONDS, musicFadeEnd, musicLoops, musicSpan, setMusicSpan, setMusicStart } from "@/lib/models/musicTrim";
import { musicSourceTime } from "@/lib/playback/engine";

const song = (extra = {}) => ({ duration: 100, startOffset: 0, endTrim: 0, loop: true, ...extra });

describe("music trim", () => {
  it("measures the played span between both trims", () => {
    expect(musicSpan(song())).toBe(100);
    expect(musicSpan(song({ startOffset: 10, endTrim: 30 }))).toBe(60);
    expect(musicSpan({ duration: 100, startOffset: 10 })).toBe(90);
  });

  it("trims the tail by setting the played length", () => {
    const m = song({ startOffset: 10 });
    setMusicSpan(m, 40);
    expect(m.endTrim).toBe(50);
    expect(musicSpan(m)).toBe(40);
  });

  it("clears the tail trim when the length reaches the end of the file", () => {
    const m = song({ startOffset: 10, endTrim: 50 });
    setMusicSpan(m, 500);
    expect(m.endTrim).toBe(0);
  });

  it("never leaves less than the minimum length", () => {
    const m = song();
    setMusicSpan(m, 0);
    expect(musicSpan(m)).toBeCloseTo(MIN_MUSIC_SECONDS);
    setMusicStart(m, 1000);
    expect(musicSpan(m)).toBeGreaterThanOrEqual(MIN_MUSIC_SECONDS - 1e-9);
    expect(m.startOffset).toBeLessThanOrEqual(m.duration - (m.endTrim ?? 0) - MIN_MUSIC_SECONDS + 1e-9);
  });

  it("does not loop once the tail is trimmed", () => {
    expect(musicLoops(song())).toBe(true);
    expect(musicLoops(song({ endTrim: 5 }))).toBe(false);
    expect(musicLoops(song({ loop: false }))).toBe(false);
  });

  it("ends the fade-out at the cut, or at the end of the video", () => {
    expect(musicFadeEnd(song(), 30)).toBe(30);
    expect(musicFadeEnd(song({ endTrim: 90 }), 30)).toBe(10);
    expect(musicFadeEnd(song({ endTrim: 10 }), 30)).toBe(30);
  });

  it("plays from the head trim and goes silent after the tail trim", () => {
    const m = song({ startOffset: 10, endTrim: 80, loop: true });
    expect(musicSourceTime(m, 0)).toBe(10);
    expect(musicSourceTime(m, 9.9)).toBeCloseTo(19.9);
    expect(musicSourceTime(m, 10)).toBeNull();
    expect(musicSourceTime(m, 500)).toBeNull();
  });

  it("still loops a song whose tail is untouched", () => {
    const m = song({ startOffset: 10, loop: true });
    expect(musicSourceTime(m, 89)).toBe(99);
    expect(musicSourceTime(m, 90)).toBe(0);
  });
});
