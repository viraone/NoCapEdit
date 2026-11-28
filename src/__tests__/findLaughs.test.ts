import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Clip } from "@/lib/models/project";

const state = vi.hoisted(() => {
  const close = vi.fn();
  const classify = vi.fn();
  const createFromOptions = vi.fn(async () => ({ classify, close }));
  const forAudioTasks = vi.fn(async () => ({}));
  const getAsset = vi.fn();
  const getSpeechAudio = vi.fn();
  return {
    close,
    classify,
    createFromOptions,
    forAudioTasks,
    getAsset,
    getSpeechAudio,
  };
});

vi.mock("@/lib/speech/audioCache", () => ({
  getSpeechAudio: (...args: Parameters<typeof state.getSpeechAudio>) => state.getSpeechAudio(...args),
}));

vi.mock("@/lib/storage/db", () => ({
  getAsset: (...args: Parameters<typeof state.getAsset>) => state.getAsset(...args),
}));

vi.mock("@mediapipe/tasks-audio", () => ({
  FilesetResolver: {
    forAudioTasks: (...args: Parameters<typeof state.forAudioTasks>) => state.forAudioTasks(...args),
  },
  AudioClassifier: {
    createFromOptions: (...args: Parameters<typeof state.createFromOptions>) => state.createFromOptions(...args),
  },
}));

import { findLaughs } from "@/lib/recap/findLaughs";

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "clip1",
    assetId: "asset1",
    inPoint: 0,
    outPoint: 10,
    hasAudio: true,
    speed: 1,
    ...overrides,
  } as unknown as Clip;
}

describe("findLaughs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.close.mockReset();
    state.classify.mockReset();
    state.createFromOptions.mockReset();
    state.forAudioTasks.mockReset();
    state.getAsset.mockReset();
    state.getSpeechAudio.mockReset();

    state.createFromOptions.mockResolvedValue({ classify: state.classify, close: state.close });
    state.forAudioTasks.mockResolvedValue({});
    state.getAsset.mockResolvedValue({ id: "asset1", blob: new Blob() });
    state.getSpeechAudio.mockResolvedValue({
      samples: new Float32Array(16000 * 10),
      sampleRate: 16000,
      duration: 10,
    });
  });

  it("rejects when no clip has sound and does not load the model", async () => {
    const clips = [makeClip({ hasAudio: false })];
    await expect(findLaughs({ clips })).rejects.toThrow("None of the clips has sound, so there are no laughs to find.");
    expect(state.createFromOptions).not.toHaveBeenCalled();
  });

  it("finds a laugh and closes the classifier", async () => {
    state.classify.mockReturnValue([
      { timestampMs: 0, classifications: [{ categories: [{ categoryName: "Laughter", score: 0.8 }] }] },
      { timestampMs: 975, classifications: [{ categories: [{ categoryName: "Laughter", score: 0.6 }] }] },
    ]);

    const clips = [makeClip()];
    const laughs = await findLaughs({ clips });

    expect(laughs.length).toBe(1);
    expect(laughs[0].clipId).toBe("clip1");
    expect(laughs[0].start).toBeCloseTo(0, 1);
    expect(laughs[0].end).toBeCloseTo(1.95, 1);
    expect(state.close).toHaveBeenCalled();
  });

  it("rejects when audio is null", async () => {
    state.getSpeechAudio.mockResolvedValue(null);
    const clips = [makeClip()];
    await expect(findLaughs({ clips })).rejects.toThrow("This video's sound could not be read.");
  });

  it("rejects with model message when createFromOptions fails", async () => {
    state.createFromOptions.mockRejectedValue(new Error("fail"));
    const clips = [makeClip()];
    await expect(findLaughs({ clips })).rejects.toThrow("The laugh model could not be loaded. It is downloaded the first time, so check the internet connection.");
  });

  it("rejects with AbortError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const clips = [makeClip()];
    await expect(findLaughs({ clips, signal: controller.signal })).rejects.toThrow(expect.objectContaining({ name: "AbortError" }));
  });
});
