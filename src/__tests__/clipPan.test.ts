import { describe, expect, it } from "vitest";
import { clipPanAt, manualPan, setManualPan, type Clip } from "@/lib/models/project";
import { fillFrame, fitFrame } from "@/lib/models/clipOps";
import { getFormat } from "@/lib/models/formats";
import { followsStale } from "@/components/canvas/FormatPicker";

const still = (): Clip => ({ zoom: 1, pan: { x: 0.1, y: 0 }, reframe: null }) as unknown as Clip;
const followed = (): Clip => ({ zoom: 1, pan: { x: -0.59, y: 0 }, reframe: { keyframes: [{ t: 0, x: 0, y: 0 }, { t: 10, x: 0.4, y: 0 }] } }) as unknown as Clip;

describe("moving the picture by hand", () => {
  it("moves a clip that follows a face, and it keeps following", () => {
    const c = followed();
    expect(clipPanAt(c, 5)).toEqual({ x: 0.2, y: 0 });
    setManualPan(c, { x: -0.3, y: 0.05 });
    expect(clipPanAt(c, 5).x).toBeCloseTo(-0.1);
    expect(clipPanAt(c, 10).x).toBeCloseTo(0.1);
    expect(clipPanAt(c, 5).y).toBeCloseTo(0.05);
  });

  it("starts a drag from the offset, not from an old static pan the path was hiding", () => {
    expect(manualPan(followed())).toEqual({ x: 0, y: 0 });
  });

  it("moves the static pan of a clip that follows nothing", () => {
    const c = still();
    expect(manualPan(c)).toEqual({ x: 0.1, y: 0 });
    setManualPan(c, { x: 0.2, y: 0 });
    expect(clipPanAt(c, 5)).toEqual({ x: 0.2, y: 0 });
  });
});

describe("Fill and Fit on a clip that follows a face", () => {
  it("Fill takes the hand move away and keeps following", () => {
    const c = followed();
    setManualPan(c, { x: -0.3, y: 0 });
    fillFrame(c);
    expect(c.zoom).toBe(1);
    expect(clipPanAt(c, 5)).toEqual({ x: 0.2, y: 0 });
  });

  it("Fit stops following, so the whole picture holds still in the frame", () => {
    const c = followed();
    fitFrame(c, 0.32);
    expect(c.zoom).toBe(0.32);
    expect(clipPanAt(c, 5)).toEqual({ x: 0, y: 0 });
  });
});

describe("followsStale (changing the frame format)", () => {
  const wide = getFormat("yt-landscape");
  const tall = getFormat("ig-reels");

  it("is true when the frame changes shape while a clip follows a face", () => {
    expect(followsStale([followed()], wide, tall)).toBe(true);
  });

  it("is false for another format of the same shape, or when nothing follows", () => {
    expect(followsStale([followed()], tall, { ...tall, id: "other" })).toBe(false);
    expect(followsStale([still()], wide, tall)).toBe(false);
  });
});
