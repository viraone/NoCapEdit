import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTrailer } from "@/lib/recap/makeTrailer";
import { createProject, createClip, type VideoProject, type Clip } from "@/lib/models/project";

vi.mock("@/lib/recap/cutPieces", () => ({
  cutPieces: vi.fn(async () => new Blob(["mock"], { type: "video/mp4" })),
}));

vi.mock("@/lib/storage/db", () => ({
  getAsset: vi.fn(async () => ({ blob: new Blob(["src"], { type: "video/mp4" }) })),
  saveProject: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
}));

vi.mock("@/lib/media/import", () => ({
  importVideo: vi.fn(async () => ({
    clip: {
      id: "clip-1",
      assetId: "asset-1",
      inPoint: 0,
      outPoint: 100,
      duration: 100,
      width: 1920,
      height: 1080,
      look: undefined,
      background: undefined,
    } as unknown as Clip,
    blob: new Blob(["imported"], { type: "video/mp4" }),
  })),
  updateProjectThumbnail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tracking/autoReframe", () => ({
  autoReframe: vi.fn(async () => []),
}));

vi.mock("@/lib/ffmpegEngine", () => ({
  ffmpegEngine: {},
  FFmpegHungError: class extends Error {},
}));

import { cutPieces } from "@/lib/recap/cutPieces";
import { importVideo } from "@/lib/media/import";
import { deleteProject } from "@/lib/storage/db";

function makeSource(): VideoProject {
  const p = createProject({ name: "Test", formatId: "16x9" });
  const clip = createClip({ name: "test", assetId: "asset-1", duration: 600, width: 1920, height: 1080, hasAudio: true });
  p.clips = [clip];
  p.cues = [
    { id: "c1", start: 95, end: 99, text: "before", words: [{ start: 95, end: 96, text: "before" }] },
    { id: "c2", start: 195, end: 199, text: "second", words: [{ start: 195, end: 196, text: "second" }] },
  ];
  return p;
}

describe("makeTrailer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects when no laughs", async () => {
    const source = makeSource();
    await expect(makeTrailer({ source, laughs: [] })).rejects.toThrow("Keep at least one moment first.");
  });

  it("cuts two pieces and builds two clips", async () => {
    const source = makeSource();
    const laughs = [
      { start: 100, end: 102 },
      { start: 200, end: 202 },
    ];
    const result = await makeTrailer({ source, laughs });

    expect(cutPieces).toHaveBeenCalledTimes(1);
    const pieces = (cutPieces as ReturnType<typeof vi.fn>).mock.calls[0][1] as { start: number; seconds: number }[];
    expect(pieces.length).toBe(2);

    expect(result.clips.length).toBe(2);
    const [c1, c2] = result.clips;
    expect(c2.inPoint).toBeCloseTo(c1.outPoint, 1);
  });

  it("shifts cues into the correct clip", async () => {
    const source = makeSource();
    const laughs = [
      { start: 100, end: 102 },
      { start: 200, end: 202 },
    ];
    const result = await makeTrailer({ source, laughs });

    // The cue at 195 should be in the second clip's range
    const secondClip = result.clips[1];
    const cueInSecond = result.cues.find((c) => c.start >= secondClip.inPoint && c.end <= secondClip.outPoint);
    expect(cueInSecond).toBeDefined();
    expect(cueInSecond!.text).toBe("second");
  });

  it("deletes the project if importVideo rejects", async () => {
    const source = makeSource();
    const laughs = [{ start: 100, end: 102 }];
    (importVideo as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Import failed"));

    await expect(makeTrailer({ source, laughs })).rejects.toThrow("Import failed");
    expect(deleteProject).toHaveBeenCalled();
  });

  it("adds name tags and closing overlay, and one-word cues", async () => {
    const source = makeSource();
    const laughs = [
      { start: 100, end: 102 },
      { start: 200, end: 202 },
    ];
    const result = await makeTrailer({
      source,
      laughs,
      nameAt: (t) => (t < 150 ? "A" : "B"),
      closing: "Follow us",
    });

    expect(result.overlays.length).toBeGreaterThanOrEqual(3);
    const o0 = result.overlays[0];
    const o1 = result.overlays[1];
    const oLast = result.overlays[result.overlays.length - 1];
    expect("text" in o0 ? o0.text : "").toBe("A");
    expect("text" in o1 ? o1.text : "").toBe("B");
    expect("text" in oLast ? oLast.text : "").toBe("Follow us");

    for (const cue of result.cues) {
      const words = cue.words?.length ? cue.words : cue.text.split(/\s+/).filter(Boolean);
      expect(words.length).toBeLessThanOrEqual(1);
    }
  });
});
