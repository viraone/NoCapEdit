import { describe, expect, it } from "vitest";
import { pictureFit } from "@/lib/models/pictureFit";
import { createClip, type MusicTrack } from "@/lib/models/project";

const clip = (duration: number, extra: Partial<ReturnType<typeof createClip>> = {}) => ({
  ...createClip({ assetId: "src", name: "c", duration, width: 1080, height: 1350, hasAudio: false }),
  ...extra,
});
const picture = (seconds = 12, extra: Partial<ReturnType<typeof createClip>> = {}) => clip(seconds, { still: true, ...extra });
const recording = (seconds: number) => clip(seconds, { hasAudio: true });
const song = (duration: number, extra: Partial<MusicTrack> = {}): MusicTrack =>
  ({ assetId: "m", name: "song", duration, volume: 0.35, fadeIn: 1, fadeOut: 2, startOffset: 0, loop: true, ...extra }) as MusicTrack;

describe("pictureFit", () => {
  it("holds a 12 s flyer for the whole of a 4-minute song", () => {
    const fit = pictureFit([picture()], song(240));
    expect(fit?.seconds).toBe(240);
    expect(fit?.known).toBe(true);
  });

  it("leaves a song that already fits, or runs only a moment over, alone", () => {
    expect(pictureFit([picture()], song(12))).toBeNull();
    expect(pictureFit([picture()], song(12.4))).toBeNull();
    expect(pictureFit([picture()], song(8))).toBeNull();
  });

  it("never stretches a real recording", () => {
    expect(pictureFit([recording(12)], song(240))).toBeNull();
    expect(pictureFit([picture(), recording(10)], song(240))).toBeNull();
  });

  it("lets the filmstrip decide for a silent clip made before pictures were flagged", () => {
    const fit = pictureFit([clip(12)], song(100));
    expect(fit?.seconds).toBe(100);
    expect(fit?.known).toBe(false);
  });

  it("counts only the part of the song that plays", () => {
    expect(pictureFit([picture()], song(240, { startOffset: 30, endTrim: 10 }))?.seconds).toBe(200);
    expect(pictureFit([picture()], song(240, { pieces: [{ from: 0, to: 20 }, { from: 100, to: 130 }] }))?.seconds).toBe(50);
  });

  it("grows only the last picture, after whatever plays before it", () => {
    const fit = pictureFit([recording(20), picture()], song(100));
    expect(fit?.clip.still).toBe(true);
    expect(fit?.seconds).toBe(80);
  });

  it("works in timeline seconds for a sped-up picture", () => {
    expect(pictureFit([picture(12, { speed: 2 })], song(60))?.seconds).toBe(60);
  });

  it("needs a song and a clip", () => {
    expect(pictureFit([picture()], null)).toBeNull();
    expect(pictureFit([], song(240))).toBeNull();
  });
});
