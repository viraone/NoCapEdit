import { describe, expect, it } from "vitest";
import { findLaughMoments, pickBiggest, playRange, toSoundFrame } from "@/lib/recap/laughMoments";

describe("laughMoments", () => {
  describe("toSoundFrame", () => {
    it("takes the maximum laugh and applause scores and ignores other categories", () => {
      const frame = toSoundFrame(1, [
        { categoryName: "Speech", score: 1 },
        { categoryName: "Laughter", score: 0.1 },
        { categoryName: "Baby laughter", score: 0.2 },
        { categoryName: "Giggle", score: 0.7 },
        { categoryName: "Snicker", score: 0.4 },
        { categoryName: "Belly laugh", score: 0.5 },
        { categoryName: "Chuckle, chortle", score: 0.3 },
        { categoryName: "Applause", score: 0.6 },
        { categoryName: "Clapping", score: 0.9 },
      ]);

      expect(frame.time).toBeCloseTo(1);
      expect(frame.laugh).toBeCloseTo(0.7);
      expect(frame.applause).toBeCloseTo(0.9);
    });

    it("returns zeros for no categories", () => {
      const frame = toSoundFrame(2, []);

      expect(frame.time).toBeCloseTo(2);
      expect(frame.laugh).toBeCloseTo(0);
      expect(frame.applause).toBeCloseTo(0);
    });
  });

  describe("findLaughMoments", () => {
    it("merges adjacent laugh frames into one moment", () => {
      const frames = [
        { time: 10, laugh: 0.8, applause: 0 },
        { time: 10.5, laugh: 0.8, applause: 0 },
        { time: 11, laugh: 0.8, applause: 0 },
      ];

      const moments = findLaughMoments(frames);

      expect(moments).toHaveLength(1);
      expect(moments[0].start).toBeCloseTo(10);
      expect(moments[0].end).toBeCloseTo(11.5);
      expect(moments[0].score).toBeCloseTo(1.2);
    });

    it("joins frames separated by exactly maxGap", () => {
      const frames = [
        { time: 0, laugh: 0.8, applause: 0 },
        { time: 0.5, laugh: 0.8, applause: 0 },
        { time: 2, laugh: 0.8, applause: 0 },
      ];

      const moments = findLaughMoments(frames);

      expect(moments).toHaveLength(1);
      expect(moments[0].start).toBeCloseTo(0);
      expect(moments[0].end).toBeCloseTo(2.5);
      expect(moments[0].score).toBeCloseTo(1.2);
    });

    it("splits when the gap is larger than maxGap", () => {
      const frames = [
        { time: 0, laugh: 0.8, applause: 0 },
        { time: 0.5, laugh: 0.8, applause: 0 },
        { time: 2.6, laugh: 0.8, applause: 0 },
        { time: 3.1, laugh: 0.8, applause: 0 },
      ];

      const moments = findLaughMoments(frames);

      expect(moments).toHaveLength(2);
      expect(moments[0].start).toBeCloseTo(0);
      expect(moments[0].end).toBeCloseTo(1);
      expect(moments[0].score).toBeCloseTo(0.8);
      expect(moments[1].start).toBeCloseTo(2.6);
      expect(moments[1].end).toBeCloseTo(3.6);
      expect(moments[1].score).toBeCloseTo(0.8);
    });

    it("drops groups shorter than minLength", () => {
      const frames = [{ time: 0, laugh: 0.8, applause: 0 }];

      expect(findLaughMoments(frames)).toEqual([]);
    });

    it("requires laugh to be at least applause and at least threshold", () => {
      const applauseWins = [
        { time: 0, laugh: 0.8, applause: 0.9 },
        { time: 0.5, laugh: 0.8, applause: 0.9 },
        { time: 1, laugh: 0.8, applause: 0.9 },
      ];

      expect(findLaughMoments(applauseWins)).toEqual([]);

      const belowThreshold = [
        { time: 0, laugh: 0.2, applause: 0 },
        { time: 0.5, laugh: 0.2, applause: 0 },
        { time: 1, laugh: 0.2, applause: 0 },
      ];

      expect(findLaughMoments(belowThreshold)).toEqual([]);
    });

    it("orders by score and does not mutate the input", () => {
      const frames = [
        { time: 10, laugh: 0.9, applause: 0 },
        { time: 0, laugh: 0.5, applause: 0 },
        { time: 10.5, laugh: 0.9, applause: 0 },
        { time: 0.5, laugh: 0.5, applause: 0 },
        { time: 11, laugh: 0.9, applause: 0 },
      ];
      const original = frames.map((frame) => ({ ...frame }));

      const moments = findLaughMoments(frames);

      expect(moments).toHaveLength(2);
      expect(moments[0].start).toBeCloseTo(10);
      expect(moments[0].score).toBeCloseTo(1.35);
      expect(moments[1].start).toBeCloseTo(0);
      expect(moments[1].score).toBeCloseTo(0.5);
      expect(frames).toEqual(original);
    });
  });

  describe("pickBiggest", () => {
    it("respects count and minSpacing and returns start order", () => {
      const moments = [
        { start: 5, end: 6, score: 10 },
        { start: 5.5, end: 6.5, score: 9 },
        { start: 0, end: 1, score: 8 },
        { start: 10, end: 11, score: 7 },
      ];

      const picked = pickBiggest(moments, 2, 1);

      expect(picked).toHaveLength(2);
      expect(picked[0].start).toBeCloseTo(0);
      expect(picked[1].start).toBeCloseTo(5);
    });

    it("returns an empty list for count 0", () => {
      const moments = [{ start: 0, end: 1, score: 1 }];

      expect(pickBiggest(moments, 0, 1)).toEqual([]);
    });
  });

  describe("playRange", () => {
    it("clamps the start to 0", () => {
      const range = playRange({ start: 2, end: 3, score: 1 }, 10);

      expect(range.start).toBeCloseTo(0);
      expect(range.end).toBeCloseTo(4);
    });

    it("clamps the end to duration", () => {
      const range = playRange({ start: 8, end: 9, score: 1 }, 9.5, 0, 1);

      expect(range.start).toBeCloseTo(8);
      expect(range.end).toBeCloseTo(9.5);
    });
  });
});
