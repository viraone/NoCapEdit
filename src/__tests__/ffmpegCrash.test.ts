import { beforeEach, describe, expect, it, vi } from "vitest";

// A stub FFmpeg whose exec rejects the way @ffmpeg/ffmpeg's worker forwards a trap: as a string.
const stub = { multithreaded: true, reject: "TypeError: Cannot read properties of undefined (reading 'startsWith')" as unknown, exitCode: null as number | null };
vi.mock("@/lib/ffmpeg/loader", () => ({
  loadFFmpeg: async () => ({
    ffmpeg: { on() {}, off() {}, terminate() {}, exec: () => (stub.exitCode === null ? Promise.reject(stub.reject) : Promise.resolve(stub.exitCode)) },
    info: { multithreaded: stub.multithreaded, source: "local" },
  }),
  resetFFmpeg: () => {},
  setSingleThreadPreference: vi.fn(),
  singleThreadPreferred: () => false,
  supportsMultithread: () => true,
  debugFlag: () => false,
}));

const { FFmpegEngine, FFmpegHungError } = await import("@/lib/ffmpegEngine");
const loader = await import("@/lib/ffmpeg/loader");

describe("exec crash fallback", () => {
  beforeEach(() => {
    stub.multithreaded = true;
    stub.reject = "TypeError: Cannot read properties of undefined (reading 'startsWith')";
    stub.exitCode = null;
    vi.mocked(loader.setSingleThreadPreference).mockClear();
  });

  it("turns a threaded-core crash into a single-threaded retry for this session only", async () => {
    const engine = new FFmpegEngine();
    await engine.load();
    const err = await engine.exec(["-i", "a.mp4", "out.mp4"]).catch((e) => e);
    expect(err).toBeInstanceOf(FFmpegHungError);
    expect(err.multithreaded).toBe(true);
    expect(engine.preferSingleThread).toBe(true);
    expect(loader.setSingleThreadPreference).not.toHaveBeenCalled();
  });

  it("wraps a single-threaded crash in a readable Error", async () => {
    stub.multithreaded = false;
    const engine = new FFmpegEngine();
    await engine.load();
    const err = await engine.exec(["-i", "a.mp4", "out.mp4"]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(FFmpegHungError);
    expect(err.message).toMatch(/^The video engine crashed: .*startsWith/);
  });

  it("rethrows the library's own Error unchanged (the cancel path)", async () => {
    const cancel = new Error("called FFmpeg.terminate()");
    stub.reject = cancel;
    const engine = new FFmpegEngine();
    await engine.load();
    await expect(engine.exec(["-i", "a.mp4", "out.mp4"])).rejects.toBe(cancel);
    expect(engine.preferSingleThread).toBe(false);
  });

  it("reports a failed probe with ffmpeg's exit code instead of an empty result", async () => {
    stub.exitCode = 1;
    const engine = new FFmpegEngine();
    await engine.load();
    await expect(engine.probe("/in/bad.mp4")).rejects.toThrow(/^ffmpeg exited with code 1\./);
  });
});
