import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeAudio, PIECEWISE_DECODE_BYTES } from "@/lib/ffmpeg/waveform";

const state = vi.hoisted(() => {
  const dispose = vi.fn();
  const track = {
    canDecode: vi.fn(async () => true),
  };
  const buffers: Array<{ buffer: { numberOfChannels: number; length: number; sampleRate: number; getChannelData: (c: number) => Float32Array }; timestamp: number }> = [];
  const throwOnBuffers = { value: false };
  return {
    dispose,
    track,
    buffers,
    throwOnBuffers,
    getPrimaryAudioTrack: vi.fn(async () => track as { canDecode: () => Promise<boolean> } | null),
    computeDuration: vi.fn(async () => 0.2),
  };
});

vi.mock("mediabunny", () => {
  class Input {
    async getPrimaryAudioTrack() {
      return state.getPrimaryAudioTrack();
    }
    async computeDuration() {
      return state.computeDuration();
    }
    dispose() {
      state.dispose();
    }
  }
  class BlobSource {}
  class AudioBufferSink {
    buffers() {
      return (async function* () {
        if (state.throwOnBuffers.value) {
          throw new Error("boom");
        }
        for (const b of state.buffers) {
          yield b;
        }
      })();
    }
  }
  return { Input, BlobSource, AudioBufferSink, ALL_FORMATS: [] };
});

function makeBuffer(sampleRate: number, length: number, left: number, right: number) {
  const l = new Float32Array(length).fill(left);
  const r = new Float32Array(length).fill(right);
  return {
    numberOfChannels: 2,
    length,
    sampleRate,
    getChannelData: (c: number) => (c === 0 ? l : r),
  };
}

describe("decodeAudio (large files / mediabunny path)", () => {
  beforeEach(() => {
    state.dispose.mockClear();
    state.track.canDecode.mockClear();
    state.track.canDecode.mockImplementation(async () => true);
    state.getPrimaryAudioTrack.mockClear();
    state.getPrimaryAudioTrack.mockImplementation(async () => state.track);
    state.computeDuration.mockClear();
    state.computeDuration.mockImplementation(async () => 0.2);
    state.buffers.length = 0;
    state.throwOnBuffers.value = false;

    state.buffers.push(
      { buffer: makeBuffer(48000, 4800, 0.5, 0.25), timestamp: 0 },
      { buffer: makeBuffer(48000, 4800, 0.5, 0.25), timestamp: 0.1 },
    );
  });

  it("decodes two stereo buffers to mono 16 kHz", async () => {
    const arrayBuffer = vi.fn();
    const blob = { size: PIECEWISE_DECODE_BYTES + 1, arrayBuffer } as unknown as Blob;

    const result = await decodeAudio(blob, 16000);

    expect(result).not.toBeNull();
    expect(result!.sampleRate).toBe(16000);
    expect(result!.samples.length).toBeGreaterThanOrEqual(3199);
    expect(result!.samples.length).toBeLessThanOrEqual(3201);
    for (let i = 0; i < result!.samples.length; i++) {
      expect(Math.abs(result!.samples[i] - 0.375)).toBeLessThan(0.001);
    }
    expect(result!.duration).toBe(result!.samples.length / 16000);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(state.dispose).toHaveBeenCalledTimes(1);
  });

  it("reports progress exactly [0, 0.5]", async () => {
    const arrayBuffer = vi.fn();
    const blob = { size: PIECEWISE_DECODE_BYTES + 1, arrayBuffer } as unknown as Blob;
    const progress: number[] = [];

    await decodeAudio(blob, 16000, (f) => progress.push(f));

    expect(progress).toEqual([0, 0.5]);
  });

  it("returns null when there is no audio track", async () => {
    state.getPrimaryAudioTrack.mockImplementation(async () => null);
    const blob = { size: PIECEWISE_DECODE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;

    const result = await decodeAudio(blob);

    expect(result).toBeNull();
    expect(state.dispose).toHaveBeenCalledTimes(1);
  });

  it("returns null when the track cannot be decoded", async () => {
    state.track.canDecode.mockImplementation(async () => false);
    const blob = { size: PIECEWISE_DECODE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;

    const result = await decodeAudio(blob);

    expect(result).toBeNull();
  });

  it("returns null when the buffers generator throws", async () => {
    state.throwOnBuffers.value = true;
    const blob = { size: PIECEWISE_DECODE_BYTES + 1, arrayBuffer: vi.fn() } as unknown as Blob;

    const result = await decodeAudio(blob);

    expect(result).toBeNull();
    expect(state.dispose).toHaveBeenCalledTimes(1);
  });
});
