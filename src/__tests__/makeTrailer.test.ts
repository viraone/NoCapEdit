import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeTrailer } from "@/lib/recap/makeTrailer";
import { createProject, createClip, type VideoProject, type Clip } from "@/lib/models/project";

vi.mock("@/lib/recap/cutPieces", () => ({
  cutEach: vi.fn(async (_blob: Blob, pieces: { start: number; seconds: number }[]) =>
    pieces.map(() => new Blob(["mock"], { type: "video/mp4" })),
  ),
}));

vi.mock("@/lib/storage/db", () => ({
  getAsset: vi.fn(async () => ({ blob: new Blob(["src"], { type: "video/mp4" }) })),
  saveProject: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
}));

let clipCounter = 0;
vi.mock("@/lib/media/import", () => ({
  importVideo: vi.fn(async (file: File) => {
    const opening = file.name === "opener.mp4";
    clipCounter++;
    return {
      clip: {
        id: opening ? "opener-clip" : `clip-${clipCounter}`,
        assetId: opening ? "opener-asset" : `asset-${clipCounter}`,
        inPoint: 0,
        outPoint: opening ? 3.5 : 100,
        duration: opening ? 3.5 : 100,
        width: 1920,
        height: 1080,
        look: undefined,
        background: undefined,
      } as unknown as Clip,
      blob: new Blob(["imported"], { type: "video/mp4" }),
    };
  }),
  updateProjectThumbnail: vi.fn(async () => undefined),
}));

vi.mock("@/lib/tracking/autoReframe", () => ({
  autoReframe: vi.fn(async () => []),
}));

vi.mock("@/lib/ffmpegEngine", () => ({
  ffmpegEngine: {},
  FFmpegHungError: class extends Error {},
}));

import { cutEach } from "@/lib/recap/cutPieces";
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
    const result = await makeTrailer({
      source,
      laughs: [],
      ranges: [
        { start: 100, end: 102 },
        { start: 200, end: 202 },
      ],
    });

    expect(cutEach).toHaveBeenCalledTimes(1);
    const pieces = (cutEach as ReturnType<typeof vi.fn>).mock.calls[0][1] as { start: number; seconds: number }[];
    expect(pieces.length).toBe(2);

    // Each piece starts 8s before the range's source start and is 16s longer
    // Range 1: source start 100, so mediaStart = 92, seconds = 2 + 16 = 18
    // Range 2: source start 200, so mediaStart = 192, seconds = 2 + 16 = 18
    expect(pieces[0].start).toBeCloseTo(92, 1);
    expect(pieces[0].seconds).toBeCloseTo(18, 1);
    expect(pieces[1].start).toBeCloseTo(192, 1);
    expect(pieces[1].seconds).toBeCloseTo(18, 1);

    expect(result.clips.length).toBe(2);
    const [c1, c2] = result.clips;
    // Each clip's inPoint should be 8 (shownIn = sourceStart - mediaStart = 8)
    expect(c1.inPoint).toBeCloseTo(8, 1);
    expect(c2.inPoint).toBeCloseTo(8, 1);
  });

  it("shifts cues into the correct clip", async () => {
    const source = makeSource();
    const laughs = [
      { start: 100, end: 102 },
      { start: 200, end: 202 },
    ];
    const result = await makeTrailer({ source, laughs });

    // The cue at 195 should be in the second clip's range
    // Second clip's place = first clip's shown length (outPoint - inPoint)
    const firstClip = result.clips[0];
    const firstShownLen = firstClip.outPoint - firstClip.inPoint;

    const cueInSecond = result.cues.find((c) => c.text === "second");
    expect(cueInSecond).toBeDefined();
    // The second clip's cues start at the first clip's shown length
    expect(cueInSecond!.start).toBeCloseTo(firstShownLen, 1);
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

  it("puts the opening shot first and shifts cues and overlays by its length", async () => {
    const source = makeSource();
    const laughs = [
      { start: 100, end: 102 },
      { start: 200, end: 202 },
    ];
    const result = await makeTrailer({
      source,
      laughs,
      opener: new Blob(["opener"], { type: "video/mp4" }),
      nameAt: (t) => (t < 150 ? "A" : "B"),
      closing: "x",
    });

    expect(result.clips.length).toBe(3);
    const openerClip = result.clips[0];
    expect(openerClip.id).toBe("opener-clip");
    const shift = openerClip.outPoint - openerClip.inPoint;
    expect(shift).toBeCloseTo(3.5, 2);

    const firstCut = result.clips[1];

    const before = result.cues.find((c) => c.text === "before");
    const second = result.cues.find((c) => c.text === "second");
    expect(before).toBeDefined();
    expect(second).toBeDefined();
    // Cues are shifted by place, which starts at openerLength for first clip
    expect(before!.start).toBeCloseTo(shift, 1);
    // Second clip's cues start at openerLength + first clip's shown length
    const firstShownLen = firstCut.outPoint - firstCut.inPoint;
    expect(second!.start).toBeCloseTo(shift + firstShownLen, 1);

    const nameA = result.overlays.find((o) => o.kind === "text" && o.text === "A");
    const closing = result.overlays.find((o) => o.kind === "text" && o.text === "x");
    expect(nameA).toBeDefined();
    expect(closing).toBeDefined();
    expect(nameA!.start).toBeCloseTo(shift, 1);
    expect(closing!.start).toBeCloseTo(shift + firstShownLen, 1);
  });

  it("uses provided ranges when given", async () => {
    const source = makeSource();
    const result = await makeTrailer({
      source,
      laughs: [],
      ranges: [{ start: 50, end: 52 }],
    });

    expect(cutEach).toHaveBeenCalledTimes(1);
    const pieces = (cutEach as ReturnType<typeof vi.fn>).mock.calls[0][1] as { start: number; seconds: number }[];
    expect(pieces.length).toBe(1);
    // mediaStart = max(0, 50 - 8) = 42, seconds = 2 + 16 = 18
    expect(pieces[0].start).toBeCloseTo(42, 1);
    expect(pieces[0].seconds).toBeCloseTo(18, 1);
    expect(result.clips.length).toBe(1);
  });
});
