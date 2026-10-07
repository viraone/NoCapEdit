import { describe, expect, it } from "vitest";
import { MIN_MUSIC_SECONDS, cutMusicAfter, cutMusicBefore, musicFadeEnd, musicIsCut, musicLoops, musicMaxSpan, musicPieceAt, musicPieces, musicSlices, musicSpan, removeMusicPiece, setMusicSpan, setMusicStart, splitMusicAt, type MusicPiece } from "@/lib/models/musicTrim";
import { musicSourceTime } from "@/lib/playback/engine";

const song = (extra: Record<string, unknown> = {}) => ({ duration: 100, startOffset: 0, endTrim: 0, loop: true, pieces: undefined as MusicPiece[] | undefined, ...extra });

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

describe("cutting the music", () => {
  it("splits one piece into two at a project time", () => {
    const m = song({ startOffset: 10 });
    expect(splitMusicAt(m, 30)).toBe(true);
    expect(m.pieces).toEqual([{ from: 10, to: 40 }, { from: 40, to: 100 }]);
    expect(musicIsCut(m)).toBe(true);
    expect(musicSpan(m)).toBe(90);
  });

  it("refuses a cut too close to an edge or to another cut", () => {
    const m = song();
    expect(splitMusicAt(m, 0.2)).toBe(false);
    expect(splitMusicAt(m, 99.9)).toBe(false);
    expect(splitMusicAt(m, 50)).toBe(true);
    expect(splitMusicAt(m, 50.2)).toBe(false);
    expect(m.pieces).toHaveLength(2);
  });

  it("removing a piece closes the gap", () => {
    const m = song();
    splitMusicAt(m, 20);
    splitMusicAt(m, 50);
    expect(m.pieces).toEqual([{ from: 0, to: 20 }, { from: 20, to: 50 }, { from: 50, to: 100 }]);
    expect(removeMusicPiece(m, 1)).toBe(true);
    expect(m.pieces).toEqual([{ from: 0, to: 20 }, { from: 50, to: 100 }]);
    expect(musicSpan(m)).toBe(70);
    expect(musicSourceTimeOf(m, 19.9)).toBeCloseTo(19.9);
    expect(musicSourceTimeOf(m, 20)).toBe(50);
    expect(musicSourceTimeOf(m, 69.9)).toBeCloseTo(99.9);
    expect(musicSourceTimeOf(m, 70)).toBeNull();
  });

  it("goes back to a plain trim when one piece is left", () => {
    const m = song();
    splitMusicAt(m, 30);
    expect(removeMusicPiece(m, 0)).toBe(true);
    expect(m.pieces).toBeUndefined();
    expect(m.startOffset).toBe(30);
    expect(m.endTrim).toBe(0);
    expect(musicLoops(m)).toBe(true);
    expect(removeMusicPiece(m, 0)).toBe(false);
  });

  it("does not loop a cut song, and fades out where it ends", () => {
    const m = song({ loop: true });
    splitMusicAt(m, 10);
    removeMusicPiece(m, 0);
    splitMusicAt(m, 20);
    expect(musicLoops(m)).toBe(false);
    expect(musicFadeEnd(m, 200)).toBe(90);
    expect(musicFadeEnd(m, 30)).toBe(30);
  });

  it("cuts away what is before or after a project time", () => {
    const m = song();
    splitMusicAt(m, 20);
    splitMusicAt(m, 60);
    expect(cutMusicBefore(m, 30)).toBe(true);
    expect(m.pieces).toEqual([{ from: 30, to: 60 }, { from: 60, to: 100 }]);
    expect(cutMusicAfter(m, 40)).toBe(true);
    expect(m.pieces).toEqual([{ from: 30, to: 60 }, { from: 60, to: 70 }]);
    expect(cutMusicAfter(m, 30)).toBe(true);
    expect(m.pieces).toBeUndefined();
    expect(m.startOffset).toBe(30);
    expect(m.endTrim).toBe(40);
    expect(musicSpan(m)).toBe(30);
    expect(cutMusicBefore(m, 29.9)).toBe(false);
    expect(cutMusicAfter(m, 0.1)).toBe(false);
  });

  it("trims the outer edges of a cut song", () => {
    const m = song();
    splitMusicAt(m, 40);
    setMusicStart(m, 10);
    expect(m.pieces?.[0]).toEqual({ from: 10, to: 40 });
    setMusicSpan(m, 50);
    expect(m.pieces).toEqual([{ from: 10, to: 40 }, { from: 40, to: 60 }]);
    expect(musicMaxSpan(m)).toBe(90);
    setMusicSpan(m, 25);
    expect(m.pieces).toBeUndefined();
    expect(m.endTrim).toBe(65);
  });

  it("finds the piece at a time and the slices an export segment reads", () => {
    const m = song();
    splitMusicAt(m, 20);
    removeMusicPiece(m, 0);
    splitMusicAt(m, 30);
    // pieces: [20,50] [50,100]; timeline 0-30 then 30-80
    expect(musicPieces(m)).toEqual([{ from: 20, to: 50 }, { from: 50, to: 100 }]);
    expect(musicPieceAt(m, 29.9)).toBe(0);
    expect(musicPieceAt(m, 30)).toBe(1);
    expect(musicPieceAt(m, 80)).toBeNull();
    expect(musicSlices(m, 25, 40)).toEqual([{ source: 45, length: 5 }, { source: 50, length: 10 }]);
    expect(musicSlices(m, 90, 100)).toEqual([]);
  });
});

function musicSourceTimeOf(m: ReturnType<typeof song>, t: number) {
  return musicSourceTime(m as Parameters<typeof musicSourceTime>[0], t);
}
