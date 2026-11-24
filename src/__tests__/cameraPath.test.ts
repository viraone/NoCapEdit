import { describe, expect, it } from "vitest";
import type { Clip } from "@/lib/models/project";
import { positionAt } from "@/lib/models/project";
import { cameraPath, dropExcursions, dropSpikes, pickSubject, splitShots, subjectPathToPan, type SubjectSample } from "@/lib/tracking/cameraPath";
import wideShot from "./fixtures/standupWideShot.samples.json";
import wideShot2 from "./fixtures/standupWideShot2.samples.json";
import wideShot3 from "./fixtures/standupWideShot3.samples.json";

// A 16:9 source filling a 9:16 frame: plenty of room to pan sideways, none up or down.
const clip = { width: 1920, height: 1080, zoom: 1 } as Clip;
const frame = { width: 1080, height: 1920 };
const at = (t: number, x: number, extra: Partial<SubjectSample> = {}): SubjectSample => ({ t, x, y: 0.5, size: 0.15, ...extra });
/** The pan that puts a face at source x in the middle of the frame. */
const centred = (x: number) => subjectPathToPan([at(0, x)], clip, frame)[0].x;
/** The face's distance from the frame centre, in frame widths, at pan `pan`. */
const offCentre = (x: number, pan: number) => Math.abs(centred(x) - pan);

describe("cameraPath (the picture moves like a camera operator)", () => {
  it("holds perfectly still while the face only wobbles near the centre", () => {
    const samples = Array.from({ length: 40 }, (_, i) => at(i / 4, 0.5 + 0.01 * Math.sin(i)));
    const kf = cameraPath(samples, clip, frame);
    expect(kf.length).toBe(1);
    expect(kf[0]).toEqual({ t: 0, x: centred(samples[0].x), y: 0 });
  });

  it("glides to recentre a face that walks away, easing in and out without overshoot", () => {
    // Standing at 0.5 for 2 s, then over 1 s walks to 0.7 and stays there.
    const samples: SubjectSample[] = [];
    for (let t = 0; t <= 8; t += 0.25) samples.push(at(t, t < 2 ? 0.5 : t < 3 ? 0.5 + (t - 2) * 0.2 : 0.7));
    const kf = cameraPath(samples, clip, frame);
    const from = centred(0.5);
    const to = centred(0.7);
    // Starts where it was, ends with the face back near the centre (it comes to rest within 3% of the frame, then holds).
    expect(kf[0].x).toBeCloseTo(from, 6);
    expect(offCentre(0.7, kf[kf.length - 1].x)).toBeLessThan(0.03);
    // Nothing moves until the face has left the comfort zone.
    expect(positionAt(kf, 2).x).toBeCloseTo(from, 6);
    // Never overshoots, never goes backwards (walking right in the source pans the picture left).
    const dir = Math.sign(to - from);
    let prev = from;
    for (const k of kf) {
      expect((k.x - to) * dir).toBeLessThanOrEqual(1e-6);
      expect((k.x - prev) * dir).toBeGreaterThanOrEqual(-1e-6);
      prev = k.x;
    }
    // Eases: the biggest step between keyframes is well under the whole move, and the first and last steps are small.
    const steps = kf.slice(1).map((k, i) => Math.abs(k.x - kf[i].x));
    const biggest = Math.max(...steps);
    expect(biggest).toBeLessThan(Math.abs(to - from) * 0.25);
    expect(steps[0]).toBeLessThan(biggest * 0.5);
    expect(steps[steps.length - 1]).toBeLessThan(biggest * 0.5);
    // At rest, near the centre, well within a couple of seconds of him stopping.
    expect(offCentre(0.7, positionAt(kf, 5.5).x)).toBeLessThan(0.03);
    expect(positionAt(kf, 5.5).x).toBe(kf[kf.length - 1].x);
  });

  it("never slides across a cut: the new shot starts framed", () => {
    const samples: SubjectSample[] = [];
    for (let t = 0; t < 3; t += 0.25) samples.push(at(t, 0.55));
    samples.push(at(3, 0.28, { cut: true, cutAt: 2.9 }));
    for (let t = 3.25; t <= 6; t += 0.25) samples.push(at(t, 0.28));
    const kf = cameraPath(samples, clip, frame);
    const before = centred(0.55);
    const after = centred(0.28);
    expect(positionAt(kf, 2.85).x).toBeCloseTo(before, 6);
    expect(positionAt(kf, 2.899).x).toBeCloseTo(before, 6);
    expect(positionAt(kf, 2.9).x).toBeCloseTo(after, 6);
    expect(positionAt(kf, 4).x).toBeCloseTo(after, 6);
    // No keyframe in between the two framings.
    for (const k of kf) expect(Math.min(Math.abs(k.x - before), Math.abs(k.x - after))).toBeLessThan(1e-6);
  });

  it("treats a face jump too fast for a person as a cut the pixels missed", () => {
    const samples = [at(0, 0.5), at(0.25, 0.5), at(0.5, 0.5), at(0.75, 0.2), at(1, 0.2), at(1.25, 0.2)];
    const shots = splitShots(samples);
    expect(shots.map((s) => s.samples.length)).toEqual([3, 3]);
    expect(shots[1].start).toBeCloseTo(0.625, 6);
    const kf = cameraPath(samples, clip, frame);
    expect(positionAt(kf, 0.6).x).toBeCloseTo(centred(0.5), 6);
    expect(positionAt(kf, 0.65).x).toBeCloseTo(centred(0.2), 6);
  });

  it("ignores a one-sample glitch instead of flinching or calling it a cut", () => {
    const samples = [at(0, 0.5), at(0.25, 0.5), at(0.5, 0.9), at(0.75, 0.5), at(1, 0.5)];
    expect(dropSpikes(samples).map((s) => s.t)).toEqual([0, 0.25, 0.75, 1]);
    const kf = cameraPath(samples, clip, frame);
    expect(kf.length).toBe(1);
    expect(kf[0].x).toBeCloseTo(centred(0.5), 6);
  });

  it("keeps following a subject who keeps walking, within a human panning speed", () => {
    // A steady walk across the stage at 0.1 of the source per second for 6 s, then standing still for 4 s.
    const samples = Array.from({ length: 41 }, (_, i) => at(i / 4, Math.min(0.8, 0.2 + i / 40)));
    const kf = cameraPath(samples, clip, frame, { maxSpeed: 0.3 });
    for (let i = 1; i < kf.length; i++) {
      const dt = kf[i].t - kf[i - 1].t;
      expect(dt).toBeGreaterThan(0.001);
      expect(Math.abs(kf[i].x - kf[i - 1].x) / dt).toBeLessThanOrEqual(0.3 + 1e-6);
    }
    // Lags behind during the walk (the cap is slower than he is) but is back near the centre once he has stood still.
    expect(offCentre(0.8, kf[kf.length - 1].x)).toBeLessThan(0.03);
  });

  it("drops a short run that jumps to someone else and comes back, but keeps a real change of place", () => {
    // On the comedian, two samples on a head in the audience (lower left), then back on the comedian.
    const glitch = [at(0, 0.67, { y: 0.2 }), at(0.25, 0.67, { y: 0.2 }), at(0.75, 0.24, { y: 0.69 }), at(1.0, 0.2, { y: 0.7 }), at(1.25, 0.66, { y: 0.74 }), at(2.0, 0.75, { y: 0.16 }), at(2.25, 0.75, { y: 0.17 })];
    expect(dropExcursions(glitch).map((s) => s.t)).toEqual([0, 0.25, 2.0, 2.25]);
    // Someone who goes somewhere else and stays there is kept.
    const moved = [at(0, 0.3), at(0.25, 0.3), at(0.5, 0.7), at(0.75, 0.7), at(1, 0.7), at(4, 0.7)];
    expect(dropExcursions(moved)).toEqual(moved);
    // A cut seen in the pixels is never dropped, even if the picture cuts back soon after.
    const cuts = [at(0, 0.3), at(0.5, 0.7, { cut: true, cutAt: 0.4 }), at(0.75, 0.7), at(1, 0.3, { cut: true, cutAt: 0.9 })];
    expect(dropExcursions(cuts)).toEqual(cuts);
  });
});

describe("cameraPath on a real wide stage shot (detections recorded from a stand-up clip)", () => {
  // 31 s, one fixed camera, the comedian pacing a little, heads of the audience in the foreground.
  // Around 18.75 to 19.25 s the detector picked an audience head three times in a row.
  const samples = wideShot as SubjectSample[];
  const realClip = { width: 1920, height: 1080, zoom: 1 } as Clip;
  const kf = cameraPath(samples, realClip, frame);
  const panAt = (t: number) => positionAt(kf, t).x;

  it("never snaps the picture to the audience and back", () => {
    for (let t = 0.1; t <= 29; t += 0.1) expect(Math.abs(panAt(t) - panAt(t - 0.1))).toBeLessThan(0.1);
  });

  it("holds still for most of the clip instead of drifting after every sway", () => {
    let moving = 0;
    for (let t = 0.1; t <= 29; t += 0.1) if (Math.abs(panAt(t) - panAt(t - 0.1)) > 0.0005) moving += 0.1;
    expect(moving).toBeLessThan(14); // it was 21 s of 29 before
  });

  it("keeps the comedian inside the frame throughout", () => {
    const ideal = subjectPathToPan(samples, realClip, frame);
    // Ignore the detector's glitches (anything in the lower half is the audience).
    samples.forEach((s, i) => {
      if (s.y < 0.5) expect(Math.abs(ideal[i].x - panAt(s.t))).toBeLessThan(0.25);
    });
  });
});

describe("cameraPath when the detector stays on an audience head for seconds (second recorded stand-up clip)", () => {
  // 33 s from the same show. From 8.0 to 10.75 s every detection is a head in the audience (lower left);
  // the comedian is found again at 11.25 s about where he was.
  const samples = wideShot2 as SubjectSample[];
  const realClip = { width: 1920, height: 1080, zoom: 1 } as Clip;
  const kf = cameraPath(samples, realClip, frame);
  const panAt = (t: number) => positionAt(kf, t).x;

  it("throws the audience run away", () => {
    // The same order cameraPath uses: lone spikes first, then runs.
    const kept = dropExcursions(dropSpikes(samples));
    expect(kept.filter((s) => s.t >= 8 && s.t <= 10.75)).toEqual([]);
    // Every audience detection (the lower half of the picture) is gone; most of the comedian's are kept.
    expect(kept.every((s) => s.y < 0.5)).toBe(true);
    expect(kept.length).toBeGreaterThan(samples.filter((s) => s.y < 0.5).length * 0.9);
  });

  it("never swings the picture across to the audience", () => {
    for (let t = 0.1; t <= 32; t += 0.1) expect(Math.abs(panAt(t) - panAt(t - 0.1))).toBeLessThan(0.1);
    // The camera never goes further across than the comedian himself ever is (the audience head would need a pan near 0.96).
    const ideal = subjectPathToPan(samples, realClip, frame);
    const furthest = Math.max(...samples.map((s, i) => (s.y < 0.5 ? ideal[i].x : -Infinity)));
    for (const k of kf) expect(k.x).toBeLessThan(furthest + 0.05);
  });

  it("keeps the comedian inside the frame throughout", () => {
    const ideal = subjectPathToPan(samples, realClip, frame);
    // Half the frame width is the edge. The worst moment is at 20 s: the detector had not seen him for
    // six seconds, the camera held, and he is a third of the frame off-centre when it finds him again.
    samples.forEach((s, i) => {
      if (s.y < 0.5) expect(Math.abs(ideal[i].x - panAt(s.t))).toBeLessThan(0.35);
    });
  });
});

describe("dropExcursions leaves real movement alone", () => {
  it("keeps someone who walks across and back at walking pace", () => {
    // 0.3 -> 0.7 over 4 s and back over 4 s: far from where he started, but never faster than a walk.
    const walk = Array.from({ length: 33 }, (_, i) => at(i / 4, i <= 16 ? 0.3 + (i / 16) * 0.4 : 0.7 - ((i - 16) / 16) * 0.4));
    expect(dropExcursions(walk)).toEqual(walk);
  });

  it("keeps a move seen after a gap in detections", () => {
    // Lost for 3 s, found 0.3 away: possible at walking pace, so it is a move and not a leap.
    const gap = [at(0, 0.3), at(0.25, 0.3), at(3.25, 0.6), at(3.5, 0.6), at(5, 0.32), at(5.25, 0.3)];
    expect(dropExcursions(gap)).toEqual(gap);
  });

  it("keeps a leap that never comes back (a cut the pixels missed)", () => {
    const cut = [at(0, 0.3), at(0.25, 0.3), at(0.5, 0.75), at(0.75, 0.75), at(3, 0.75), at(9, 0.75)];
    expect(dropExcursions(cut)).toEqual(cut);
  });
});

describe("pickSubject (several people reported at one moment)", () => {
  it("keeps the one who carries on from the person followed so far", () => {
    // The performer up on the stage, and from 1 s a head in the audience reported alongside him.
    const both = [at(0, 0.6, { y: 0.2 }), at(0.25, 0.61, { y: 0.2 }), at(1, 0.22, { y: 0.75 }), at(1, 0.63, { y: 0.2 }), at(1.25, 0.2, { y: 0.74 }), at(1.25, 0.64, { y: 0.21 })];
    expect(pickSubject(both).map((s) => s.x)).toEqual([0.6, 0.61, 0.63, 0.64]);
  });

  it("starts with the biggest figure when there is nobody to carry on from", () => {
    const first = [at(0, 0.2, { size: 0.05 }), at(0, 0.6, { size: 0.15 }), at(0.25, 0.6, { size: 0.15 })];
    expect(pickSubject(first).map((s) => s.x)).toEqual([0.6, 0.6]);
  });

  it("keeps the nearest when nobody there could be the same person, and leaves one-per-moment input alone", () => {
    const alone = [at(0, 0.6, { y: 0.2 }), at(0.25, 0.6, { y: 0.2 }), at(0.5, 0.2, { y: 0.75 }), at(0.75, 0.6, { y: 0.2 })];
    expect(pickSubject(alone)).toEqual(alone);
  });
});

describe("cameraPath when the performer turns away and walks off to the side (third recorded stand-up clip)", () => {
  // 32 s from the same show, recorded with the detector reporting everyone it sees. From 15 to 23 s he is
  // side-on or facing away; from 24 to 25.25 s the only detection is a head in the audience at the lower left,
  // while he walks from the middle to the far right.
  const samples = wideShot3 as SubjectSample[];
  const realClip = { width: 1920, height: 1080, zoom: 1 } as Clip;
  const kf = cameraPath(samples, realClip, frame);
  const panAt = (t: number) => positionAt(kf, t).x;
  const onStage = (s: SubjectSample) => s.y < 0.5;

  it("never follows the head in the audience", () => {
    const kept = dropExcursions(dropSpikes(pickSubject(samples)));
    expect(kept.every(onStage)).toBe(true);
    for (let t = 0.1; t <= 31.5; t += 0.1) expect(Math.abs(panAt(t) - panAt(t - 0.1))).toBeLessThan(0.1);
    // The audience head would need a pan near +0.84. He is never left of the middle by much.
    for (const k of kf) expect(k.x).toBeLessThan(0.3);
  });

  it("keeps the performer in the picture, including while he walks off to the right", () => {
    const ideal = subjectPathToPan(samples, realClip, frame);
    // Half the frame width is the edge of the picture.
    samples.forEach((s, i) => {
      if (onStage(s)) expect(Math.abs(ideal[i].x - panAt(s.t))).toBeLessThan(0.5);
    });
    // And by 27 s, two seconds after he stops, he is back near the middle.
    const late = samples.map((s, i) => ({ s, i })).filter(({ s }) => onStage(s) && s.t >= 27 && s.t <= 29.5);
    for (const { s, i } of late) expect(Math.abs(ideal[i].x - panAt(s.t))).toBeLessThan(0.2);
  });
});
