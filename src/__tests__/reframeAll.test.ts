import { describe, expect, it, vi } from "vitest";
import type { Clip } from "@/lib/models/project";
import { reframeAll, reframePlan } from "@/lib/tracking/reframeAll";

const track = vi.fn();
vi.mock("@/lib/tracking/autoReframe", () => ({ autoReframe: (o: unknown) => track(o) }));

const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({ id, assetId: `asset-${id}`, ...extra }) as unknown as Clip;
const frame = { width: 1080, height: 1920 };
const tracked = clip("done", { reframe: { keyframes: [{ t: 0, x: 0, y: 0 }] } });

describe("reframePlan (which clips the Auto-Reframe button tracks)", () => {
  it("tracks videos that are not following a face yet, and skips pictures", () => {
    const plan = reframePlan([clip("a"), tracked, clip("pic", { still: true }), clip("b", { reframe: null })]);
    expect(plan.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("tracks every video again when asked to redo", () => {
    expect(reframePlan([clip("a"), tracked, clip("pic", { still: true })], true).map((c) => c.id)).toEqual(["a", "done"]);
  });
});

describe("reframeAll (one run over several clips)", () => {
  it("hands each clip its keyframes as soon as it is done, and carries on past a clip with no face", async () => {
    track.mockReset();
    track.mockImplementationOnce(async () => [{ t: 0, x: 0.1, y: 0 }]).mockImplementationOnce(async () => {
      throw new Error("No face was detected in this clip.");
    }).mockImplementationOnce(async () => [{ t: 1, x: 0.2, y: 0 }]);
    const done: [string, unknown][] = [];
    const clips = [clip("a"), clip("b"), clip("c")];
    const urls = Object.fromEntries(clips.map((c) => [c.assetId, `blob:${c.id}`]));
    await reframeAll({ clips, urls, frame, onClipDone: (c, r) => done.push([c.id, r]) });
    expect(done).toEqual([
      ["a", { keyframes: [{ t: 0, x: 0.1, y: 0 }] }],
      ["b", { error: "No face was detected in this clip." }],
      ["c", { keyframes: [{ t: 1, x: 0.2, y: 0 }] }],
    ]);
    expect(track).toHaveBeenCalledTimes(3);
    expect(track.mock.calls[0][0]).toMatchObject({ videoUrl: "blob:a", frame });
  });

  it("reports a clip whose file is not loaded instead of stopping", async () => {
    track.mockReset();
    track.mockResolvedValue([{ t: 0, x: 0, y: 0 }]);
    const done: string[] = [];
    await reframeAll({ clips: [clip("missing"), clip("a")], urls: { "asset-a": "blob:a" }, frame, onClipDone: (c, r) => done.push(`${c.id}:${"error" in r ? "error" : "ok"}`) });
    expect(done).toEqual(["missing:error", "a:ok"]);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it("says which clip of how many is scanning", async () => {
    track.mockReset();
    track.mockImplementation(async (o: { onProgress: (m: string, p: number | null) => void }) => {
      o.onProgress("Scanning", 0.5);
      return [{ t: 0, x: 0, y: 0 }];
    });
    const seen: string[] = [];
    const clips = [clip("a"), clip("b")];
    await reframeAll({ clips, urls: { "asset-a": "u", "asset-b": "u" }, frame, onProgress: (p) => seen.push(`${p.clip.id} ${p.index + 1}/${p.count} ${p.message}`), onClipDone: () => undefined });
    expect(seen).toEqual(["a 1/2 Scanning", "b 2/2 Scanning"]);
  });

  it("stops at a cancel and does not start the next clip", async () => {
    track.mockReset();
    const controller = new AbortController();
    track.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Cancelled", "AbortError");
    });
    const done: string[] = [];
    const run = reframeAll({ clips: [clip("a"), clip("b")], urls: { "asset-a": "u", "asset-b": "u" }, frame, signal: controller.signal, onClipDone: (c) => done.push(c.id) });
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(done).toEqual([]);
    expect(track).toHaveBeenCalledTimes(1);
  });
});
