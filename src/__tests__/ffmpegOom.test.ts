import { beforeEach, describe, expect, it, vi } from "vitest";

// A stub FFmpeg whose exec logs some lines, then exits with the given code (the way the threaded core reports an OOM abort).
const stub = { multithreaded: true, logs: [] as string[], exitCode: -1 };
let onLog: ((e: { message: string }) => void) | null = null;
vi.mock("@/lib/ffmpeg/loader", () => ({
  loadFFmpeg: async () => ({
    ffmpeg: {
      on(_: string, cb: (e: { message: string }) => void) {
        onLog = cb;
      },
      off() {},
      terminate() {},
      exec: async () => {
        for (const message of stub.logs) onLog?.({ message });
        return stub.exitCode;
      },
    },
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

describe("out of memory on the threaded core", () => {
  beforeEach(() => {
    stub.multithreaded = true;
    stub.logs = ["frame=    1 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x", "Aborted(OOM)"];
    stub.exitCode = -1;
    vi.mocked(loader.setSingleThreadPreference).mockClear();
  });

  it("asks for a single-threaded retry, says why, and remembers nothing for later sessions", async () => {
    const engine = new FFmpegEngine();
    await engine.load();
    const err = await engine.exec(["-i", "a.mp4", "out.mp4"]).catch((e) => e);
    expect(err).toBeInstanceOf(FFmpegHungError);
    expect(err.multithreaded).toBe(true);
    expect(err.why).toBe("ran out of memory");
    expect(engine.preferSingleThread).toBe(true);
    expect(loader.setSingleThreadPreference).not.toHaveBeenCalled();
  });

  it("leaves an ordinary failure alone", async () => {
    stub.logs = ["Error opening input file"];
    const engine = new FFmpegEngine();
    await engine.load();
    await expect(engine.exec(["-i", "a.mp4", "out.mp4"])).resolves.toBe(-1);
    expect(engine.preferSingleThread).toBe(false);
  });

  it("leaves the single-threaded core's failures alone (nothing to fall back to)", async () => {
    stub.multithreaded = false;
    const engine = new FFmpegEngine();
    await engine.load();
    await expect(engine.exec(["-i", "a.mp4", "out.mp4"])).resolves.toBe(-1);
  });
});
