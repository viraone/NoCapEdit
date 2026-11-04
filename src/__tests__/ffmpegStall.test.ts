import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stub FFmpeg: each exec takes its next answer from `script`, and "hang" never comes back.
const script: (number | "hang")[] = [];
vi.mock("@/lib/ffmpeg/loader", () => ({
  loadFFmpeg: async (opts: { forceSingleThread?: boolean }) => ({
    ffmpeg: {
      on() {},
      off() {},
      terminate() {},
      createDir: async () => true,
      mount: async () => true,
      unmount: async () => true,
      deleteDir: async () => true,
      deleteFile: async () => true,
      readFile: async () => new Uint8Array([1]),
      exec: () => {
        const next = script.shift();
        return next === "hang" || next === undefined ? new Promise<number>(() => undefined) : Promise.resolve(next);
      },
    },
    info: { multithreaded: !opts.forceSingleThread, source: "local" },
  }),
  resetFFmpeg: () => {},
  setSingleThreadPreference: vi.fn(),
  singleThreadPreferred: () => false,
  supportsMultithread: () => true,
  debugFlag: () => false,
}));

const { FFmpegEngine, SilenceWatch, WATCHDOG_CONFIRM_SECONDS, WATCHDOG_SECONDS } = await import("@/lib/ffmpegEngine");
const loader = await import("@/lib/ffmpeg/loader");
type Job = Parameters<InstanceType<typeof FFmpegEngine>["render"]>[0];

describe("SilenceWatch", () => {
  const LIMIT = 40_000;
  const CONFIRM = 6_000;

  it("is not hung while the engine keeps logging", () => {
    const watch = new SilenceWatch(LIMIT, CONFIRM);
    expect(watch.isHung(39_000, 0)).toBe(false);
    expect(watch.isHung(100_000, 90_000)).toBe(false);
  });

  it("only suspects at first, and calls it hung if the silence lasts through the confirmation wait", () => {
    const watch = new SilenceWatch(LIMIT, CONFIRM);
    expect(watch.isHung(41_000, 0)).toBe(false);
    expect(watch.isHung(43_000, 0)).toBe(false);
    expect(watch.isHung(47_000, 0)).toBe(true);
  });

  it("forgives a long gap when the engine speaks up after it, as it does when a Mac wakes from sleep", () => {
    const watch = new SilenceWatch(LIMIT, CONFIRM);
    expect(watch.isHung(600_000, 0)).toBe(false);
    expect(watch.isHung(602_000, 601_000)).toBe(false);
    // The suspicion is gone: new silence starts its own confirmation wait.
    expect(watch.isHung(642_000, 601_000)).toBe(false);
    expect(watch.isHung(646_000, 601_000)).toBe(false);
    expect(watch.isHung(648_000, 601_000)).toBe(true);
  });

  it("still catches a real hang when a hidden tab checks only once a minute", () => {
    const watch = new SilenceWatch(LIMIT, CONFIRM);
    expect(watch.isHung(60_000, 0)).toBe(false);
    expect(watch.isHung(120_000, 0)).toBe(true);
  });
});

describe("a stall during a render", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.mocked(loader.setSingleThreadPreference).mockClear();
    script.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const segment = (index: number): Job["segments"][number] => ({ index, start: index, end: index + 1, args: () => ["-i", "a.mp4", `seg_${index}.mp4`] });
  const job = (segments: number, write: (data: Uint8Array) => void): Job => ({
    inputs: [{ name: "a.mp4", blob: new Blob(["a"]) }],
    segments: Array.from({ length: segments }, (_, i) => segment(i)),
    duration: segments,
    fragmented: false,
    sink: { write: async (data: Uint8Array) => write(data) } as unknown as Job["sink"],
  });
  const waitPastWatchdog = () => vi.advanceTimersByTimeAsync((WATCHDOG_SECONDS + WATCHDOG_CONFIRM_SECONDS + 10) * 1000);

  it("keeps the threaded engine for later sessions once it has finished a part, and still finishes single-threaded now", async () => {
    script.push(0, "hang", 0);
    let written = 0;
    const notices: (string | undefined)[] = [];
    const engine = new FFmpegEngine();
    const done = engine.render(job(2, () => void written++), (p) => notices.push(p.notice));
    await waitPastWatchdog();
    const stats = await done;
    expect(written).toBe(2);
    expect(stats.info.multithreaded).toBe(false);
    expect(engine.preferSingleThread).toBe(true);
    expect(loader.setSingleThreadPreference).not.toHaveBeenCalled();
    expect(notices.at(-1)).toMatch(/fast video engine stalled at part 2\. The parts already done are kept/);
  });

  it("writes the threaded engine off for later sessions when it never finished a part", async () => {
    script.push("hang", 0);
    const engine = new FFmpegEngine();
    const done = engine.render(job(1, () => undefined), () => undefined);
    await waitPastWatchdog();
    await done;
    expect(loader.setSingleThreadPreference).toHaveBeenCalledWith(true);
  });
});
