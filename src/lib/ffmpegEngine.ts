/**
 * ffmpegEngine — the WebAssembly FFmpeg wrapper used by every export path.
 *
 *  - loads @ffmpeg/core-mt (SharedArrayBuffer threads) when the page is
 *    cross-origin isolated, otherwise the single-threaded core
 *  - mounts source Blobs into the worker's virtual FS without copying them
 *  - probes media (duration, fps, pixel format, HDR colour metadata)
 *  - encodes any resolution (up to 4K/2160p and beyond), 24/30/60 fps,
 *    CRF or fixed-bitrate rate control, x264/x265 presets
 *  - tone-maps 10-bit HDR (BT.2020 PQ/HLG) sources to SDR BT.709 with
 *    zscale + tonemap inside the filter graph
 *  - renders long jobs as fragmented-MP4 segments and streams each one to a
 *    File System Access API writable (or Blob) so memory stays bounded
 *
 * All commands run inside the FFmpeg class's dedicated Web Worker; this file
 * only orchestrates them from the main thread.
 */
import type { FFFSType, FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import { loadFFmpeg, resetFFmpeg, setSingleThreadPreference, singleThreadPreferred, supportsMultithread, debugFlag, type FFmpegInfo } from "./ffmpeg/loader";
import { parseTrackTiming, renumberFragments, shiftFragments, stripInitSegment, stripTrailingIndex, type TrackTiming } from "./ffmpeg/mp4";
import type { OutputSink } from "./ffmpeg/sinks";

export type { FFmpegInfo } from "./ffmpeg/loader";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type VideoCodec = "h264" | "h265";
export type X264Preset = "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow";
export type RateControl = { mode: "crf"; crf: number } | { mode: "bitrate"; kbps: number; maxrateKbps?: number };
export type HdrMode = "auto" | "tonemap" | "passthrough";

export interface EncodeSettings {
  width: number;
  height: number;
  fps: number;
  codec: VideoCodec;
  preset: X264Preset;
  rateControl: RateControl;
  audioBitrateKbps: number;
  /** Keyframe interval in seconds (also the fragment size when streaming). */
  gopSeconds: number;
  hdr: HdrMode;
}

export const RESOLUTION_PRESETS: { id: string; label: string; height: number | null }[] = [
  { id: "native", label: "Format native", height: null },
  { id: "720", label: "720p", height: 720 },
  { id: "1080", label: "1080p (Full HD)", height: 1080 },
  { id: "1440", label: "1440p (2K)", height: 1440 },
  { id: "2160", label: "2160p (4K)", height: 2160 },
];

export const AUDIO_RATE = 48000;

/** Canonical HDR (PQ / HLG, BT.2020) -> SDR BT.709 tone-mapping chain. */
export function hdrToSdrChain(): string {
  return [
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ].join(",");
}

/** Output (encoder) arguments. `tsOffset` shifts timestamps for streamed segments. */
export function encoderArgs(s: EncodeSettings, opts: { fragmented: boolean; tsOffset: number; duration: number }): string[] {
  const args: string[] = [];
  const gop = Math.max(1, Math.round(s.gopSeconds * s.fps));
  if (s.codec === "h265") {
    args.push("-c:v", "libx265", "-preset", s.preset, "-tag:v", "hvc1");
    if (s.rateControl.mode === "crf") args.push("-crf", String(s.rateControl.crf));
    else args.push("-b:v", `${s.rateControl.kbps}k`, "-maxrate", `${s.rateControl.maxrateKbps ?? Math.round(s.rateControl.kbps * 1.5)}k`, "-bufsize", `${s.rateControl.kbps * 2}k`);
    args.push("-x265-params", `keyint=${gop}:min-keyint=${gop}:log-level=error${opts.fragmented ? ":bframes=0" : ""}`);
  } else {
    args.push("-c:v", "libx264", "-preset", s.preset, "-profile:v", "high", "-level", s.height > 1080 || s.fps > 30 ? "5.1" : "4.1");
    if (s.rateControl.mode === "crf") args.push("-crf", String(s.rateControl.crf));
    else args.push("-b:v", `${s.rateControl.kbps}k`, "-maxrate", `${s.rateControl.maxrateKbps ?? Math.round(s.rateControl.kbps * 1.5)}k`, "-bufsize", `${s.rateControl.kbps * 2}k`);
    args.push("-g", String(gop), "-keyint_min", String(gop), "-sc_threshold", "0");
    // No B-frames for spliced segments: decode order then has no delay at the seams.
    if (opts.fragmented) args.push("-bf", "0");
  }
  args.push("-pix_fmt", "yuv420p", "-r", String(s.fps));
  args.push("-c:a", "aac", "-b:a", `${s.audioBitrateKbps}k`, "-ar", String(AUDIO_RATE));
  if (opts.fragmented) {
    // Every segment starts at t=0; the splicer shifts fragment decode times.
    // The default "make non-negative" policy stretches the first frame by one
    // audio frame, which would show up as a hiccup at every splice point.
    // delay_moov holds the moov back until the first fragment is cut so it can
    // carry the audio edit list (AAC priming, 1024 samples); with empty_moov
    // alone the moov is written before any packet and no edit list is possible,
    // which made the priming samples play as 21 ms of audio lag.
    args.push("-movflags", "frag_keyframe+empty_moov+default_base_moof+delay_moov", "-avoid_negative_ts", "disabled");
  } else {
    args.push("-movflags", "+faststart");
  }
  args.push("-t", opts.duration.toFixed(4));
  return args;
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

export interface VideoStreamInfo {
  codec: string;
  pixFmt: string;
  width: number;
  height: number;
  fps: number;
  bitDepth: number;
  colorPrimaries: string | null;
  colorTransfer: string | null;
  isHdr: boolean;
}
export interface AudioStreamInfo {
  codec: string;
  sampleRate: number;
  channels: string;
}
export interface MediaInfo {
  duration: number;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
}

export function parseProbeLog(lines: string[]): MediaInfo {
  let duration = 0;
  let video: VideoStreamInfo | null = null;
  let audio: AudioStreamInfo | null = null;
  for (const line of lines) {
    const d = line.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (d) duration = Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]);
    const v = line.match(/Stream #\d+:\d+.*?Video:\s*([a-z0-9_]+)[^,]*,\s*([a-z0-9]+)(?:\(([^)]*)\))?[^,]*,\s*(\d+)x(\d+)/i);
    if (v && !video) {
      const meta = (v[3] ?? "").toLowerCase();
      const fps = line.match(/([\d.]+)\s*fps/);
      const parts = meta.split(/[\/,\s]+/).filter(Boolean);
      const transfer = parts.find((p) => ["smpte2084", "arib-std-b67", "bt709", "bt2020-10", "bt2020-12", "smpte170m", "bt470bg"].includes(p)) ?? null;
      const primaries = parts.find((p) => ["bt2020", "bt709", "smpte170m", "bt470bg"].includes(p)) ?? null;
      const pixFmt = v[2].toLowerCase();
      const depthMatch = pixFmt.match(/p?(10|12|16)(le|be)?$/);
      const bitDepth = depthMatch ? Number(depthMatch[1]) : 8;
      const isHdr = transfer === "smpte2084" || transfer === "arib-std-b67" || (primaries === "bt2020" && bitDepth > 8);
      video = { codec: v[1].toLowerCase(), pixFmt, width: Number(v[4]), height: Number(v[5]), fps: fps ? Number(fps[1]) : 30, bitDepth, colorPrimaries: primaries, colorTransfer: transfer, isHdr };
    }
    const a = line.match(/Stream #\d+:\d+.*?Audio:\s*([a-z0-9_]+)[^,]*,\s*(\d+)\s*Hz,\s*([^,]+)/i);
    if (a && !audio) audio = { codec: a[1].toLowerCase(), sampleRate: Number(a[2]), channels: a[3].trim() };
  }
  return { duration, video, audio };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export interface RenderInput {
  /** File name inside the worker FS (e.g. clip0.mp4). */
  name: string;
  blob: Blob;
}

export interface SegmentContext {
  ffmpeg: FFmpeg;
  /** Resolves a mounted input name to its path in the worker FS. */
  inputPath: (name: string) => string;
  output: string;
  /** Files created by `prepare` that should be removed after the segment. */
  temp: string[];
}

export interface RenderSegmentJob {
  index: number;
  start: number;
  end: number;
  /** Optional hook to write extra inputs (overlay PNGs, frame sequences…). */
  prepare?: (ctx: SegmentContext) => Promise<void>;
  /** Full argument list for this segment, excluding nothing (must include output). */
  args: (ctx: SegmentContext) => string[];
}

export interface RenderJob {
  inputs: RenderInput[];
  /** Runs once after inputs are mounted (e.g. probing) and before any segment. */
  beforeSegments?: (inputPath: (name: string) => string) => Promise<void>;
  segments: RenderSegmentJob[];
  duration: number;
  sink: OutputSink;
  /** True when segments are fragmented MP4 that must be spliced. */
  fragmented: boolean;
}

export interface RenderProgress {
  stage: "loading" | "preparing" | "encoding" | "writing" | "done";
  progress: number;
  message: string;
  segment?: number;
  segments?: number;
  /** The engine actually running this render (known once loading is done). */
  engine?: FFmpegInfo;
}

export interface RenderStats {
  seconds: number;
  bytes: number;
  segments: number;
  info: FFmpegInfo;
}

const abortError = () => new DOMException("Render cancelled", "AbortError");

/**
 * Thrown when a core stops producing output. `multithreaded` says which core
 * hung: callers retry single-threaded after a threaded hang and give up after
 * a single-threaded one.
 */
export class FFmpegHungError extends Error {
  readonly multithreaded: boolean;
  constructor(multithreaded: boolean, message?: string) {
    super(message ?? (multithreaded ? "The multi-threaded video engine stopped responding." : "The video engine stopped responding."));
    this.name = "FFmpegHungError";
    this.multithreaded = multithreaded;
  }
}

/** Seconds of log silence after which a threaded exec is considered hung. */
export const WATCHDOG_SECONDS = 40;
/**
 * Silence threshold for the single-threaded core. Much longer, because a slow
 * preset at 4K legitimately logs nothing until x264/x265 fills its lookahead.
 */
export const SINGLE_THREAD_WATCHDOG_SECONDS = 180;

const watchdogChecks: ReturnType<typeof setInterval>[] = [];

// ---------------------------------------------------------------------------
// Thread budget for the multi-threaded core
// ---------------------------------------------------------------------------

/**
 * @ffmpeg/core-mt pre-spawns a fixed pool of pthread workers (32 in 0.12.x).
 * With `-threads auto` ffmpeg asks for far more on a many-core machine (x264
 * alone wants 1.5x the cores, every decoder and filter graph wants a full set),
 * and a thread beyond the pool can never start: the class worker is blocked
 * inside the synchronous exec, so the new worker's "loaded" message is never
 * processed and the command deadlocks silently. Every command run on the
 * threaded core therefore carries explicit, budgeted caps.
 */
export const MT_THREAD_POOL = 32;
/** Planned threads per command; the rest of the pool is headroom for x264's lookahead thread and similar helpers. */
export const MT_THREAD_BUDGET = 24;

export interface ThreadPlan {
  /** Frame threads per decoder (one decoder per input). */
  decoder: number;
  /** Encoder threads (x264 / x265). */
  encoder: number;
  /** Filter graph threads (-filter_threads and -filter_complex_threads). */
  filter: number;
}

export function threadPlan(inputs: number, cores: number): ThreadPlan {
  const c = Math.max(1, Math.floor(cores || 4));
  const n = Math.max(1, inputs);
  let filter = c >= 8 ? 2 : 1;
  let encoder = Math.min(8, Math.max(2, c));
  let decoder = c >= 4 ? 2 : 1;
  const total = () => n * decoder + encoder + 2 * filter;
  if (total() > MT_THREAD_BUDGET) decoder = 1;
  if (total() > MT_THREAD_BUDGET) filter = 1;
  while (total() > MT_THREAD_BUDGET && encoder > 2) encoder--;
  return { decoder, encoder, filter };
}

export function countInputs(args: string[]): number {
  return args.filter((a) => a === "-i").length;
}

/**
 * Inserts the caps into a command line: `-threads d` before every `-i` that
 * has no explicit thread option, `-threads e` before the output (the last
 * token) and the global filter caps up front.
 */
export function withThreadCaps(args: string[], plan: ThreadPlan): string[] {
  const out: string[] = ["-filter_threads", String(plan.filter), "-filter_complex_threads", String(plan.filter)];
  let explicit = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-threads" || a.startsWith("-threads:")) explicit = true;
    if (a === "-i") {
      if (!explicit) out.push("-threads", String(plan.decoder));
      explicit = false;
    }
    const isOutput = i === args.length - 1 && i > 0 && (a === "-" || !a.startsWith("-")) && args[i - 1] !== "-i";
    if (isOutput && !explicit) out.push("-threads", String(plan.encoder));
    out.push(a);
  }
  return out;
}

function hardwareThreads(): number {
  return typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 4;
}

export class FFmpegEngine {
  private ffmpeg: FFmpeg | null = null;
  private info: FFmpegInfo | null = null;
  private logs: string[] = [];
  private capture: ((line: string) => void) | null = null;
  private lastLogAt = 0;
  /** Set after a hang (and remembered in localStorage): every later load uses the single-threaded core. */
  preferSingleThread = singleThreadPreferred();
  private logHandler = ({ message }: { message: string }) => {
    this.logs.push(message);
    if (this.logs.length > 500) this.logs.shift();
    this.lastLogAt = performance.now();
    this.capture?.(message);
  };

  static isMultithreadCapable(): boolean {
    return supportsMultithread();
  }

  async load(onStatus?: (message: string) => void): Promise<FFmpegInfo> {
    const { ffmpeg, info } = await loadFFmpeg({ onStatus, forceSingleThread: this.preferSingleThread });
    if (this.ffmpeg !== ffmpeg) {
      this.ffmpeg?.off("log", this.logHandler);
      ffmpeg.on("log", this.logHandler);
      this.ffmpeg = ffmpeg;
      this.info = info;
    }
    return info;
  }

  get loadedInfo(): FFmpegInfo | null {
    return this.info;
  }

  get instance(): FFmpeg {
    if (!this.ffmpeg) throw new Error("FFmpeg engine is not loaded");
    return this.ffmpeg;
  }

  recentLogs(n = 12): string {
    return this.logs.slice(-n).join("\n");
  }

  /** Mounts Blobs read-only into the worker FS. Falls back to copying into MEMFS. */
  async mountInputs(inputs: RenderInput[]): Promise<{ inputPath: (name: string) => string; release: () => Promise<void> }> {
    const ffmpeg = this.instance;
    const dir = `/in_${Date.now().toString(36)}`;
    try {
      await ffmpeg.createDir(dir).catch(() => undefined);
      // String literal: the enum is type-only here so the SSR stub of @ffmpeg/ffmpeg does not need it.
      await ffmpeg.mount("WORKERFS" as FFFSType, { blobs: inputs.map((i) => ({ name: i.name, data: i.blob })) }, dir);
      return {
        inputPath: (name) => `${dir}/${name}`,
        release: async () => {
          await ffmpeg.unmount(dir).catch(() => undefined);
          await ffmpeg.deleteDir(dir).catch(() => undefined);
        },
      };
    } catch {
      for (const i of inputs) await ffmpeg.writeFile(i.name, await fetchFile(i.blob));
      return {
        inputPath: (name) => name,
        release: async () => {
          for (const i of inputs) await ffmpeg.deleteFile(i.name).catch(() => undefined);
        },
      };
    }
  }

  async exec(args: string[], onTime?: (seconds: number) => void, onLine?: (line: string) => void): Promise<number> {
    const ffmpeg = this.instance;
    this.capture =
      onTime || onLine
        ? (line) => {
            onLine?.(line);
            if (!onTime) return;
            const m = line.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/);
            if (m) onTime(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]));
          }
        : null;
    let code = -1;
    let hung = false;
    const multithreaded = !!this.info?.multithreaded;
    // The threaded core needs explicit thread caps (see threadPlan); the
    // single-threaded core ignores them, so it gets the command untouched.
    const finalArgs = multithreaded ? withThreadCaps(args, threadPlan(countInputs(args), hardwareThreads())) : args;
    if (debugFlag("debug")) console.debug("[ffmpeg] exec", { multithreaded, args: finalArgs.join(" ") });
    this.lastLogAt = performance.now();
    // Watchdog: ffmpeg logs at least every second or so while working, so long
    // silence means the worker is dead or deadlocked. The single-threaded core
    // gets a much longer leash (slow presets are quiet while filling lookahead).
    const limit = (multithreaded ? WATCHDOG_SECONDS : SINGLE_THREAD_WATCHDOG_SECONDS) * 1000;
    const watchdog = setInterval(() => {
      if (performance.now() - this.lastLogAt > limit) {
        hung = true;
        this.cancel();
      }
    }, 2000);
    try {
      code = await Promise.race([
        ffmpeg.exec(finalArgs),
        new Promise<number>((_, reject) => {
          const check = setInterval(() => {
            if (hung) {
              clearInterval(check);
              reject(new FFmpegHungError(multithreaded));
            }
          }, 500);
          watchdogChecks.push(check);
        }),
      ]);
      return code;
    } catch (e) {
      if (hung) {
        if (multithreaded) {
          // Never wait for this watchdog again on this device.
          this.preferSingleThread = true;
          setSingleThreadPreference(true);
        }
        throw new FFmpegHungError(multithreaded);
      }
      throw e;
    } finally {
      clearInterval(watchdog);
      for (const c of watchdogChecks.splice(0)) clearInterval(c);
      this.capture = null;
      // A failed command makes the threaded core call abort(); its worker pool is
      // then unusable, so recycle the instance for the next call.
      if (code !== 0 && multithreaded) this.cancel();
    }
  }

  /**
   * Reads container/stream information by parsing ffmpeg's input dump. The
   * command decodes a single frame into the null muxer so it exits with 0:
   * an erroring command (e.g. `-i file` alone) aborts the threaded core.
   * A single decoder thread is plenty for one frame and keeps the probe far
   * inside the threaded core's pool.
   */
  async probe(path: string): Promise<MediaInfo> {
    const lines: string[] = [];
    // Goes through exec() so the hang watchdog covers probing too.
    await this.exec(["-hide_banner", "-threads", "1", "-i", path, "-frames:v", "1", "-frames:a", "1", "-f", "null", "-"], undefined, (line) => lines.push(line));
    return parseProbeLog(lines);
  }

  async probeBlob(blob: Blob, name = "probe.bin"): Promise<MediaInfo> {
    await this.load();
    const mounted = await this.mountInputs([{ name, blob }]);
    try {
      return await this.probe(mounted.inputPath(name));
    } finally {
      await mounted.release();
    }
  }

  /**
   * Renders every segment in order and streams the result into `job.sink`.
   * Fragmented segments are spliced into one MP4 (init from the first one).
   */
  async render(job: RenderJob, onProgress: (p: RenderProgress) => void, signal?: AbortSignal): Promise<RenderStats> {
    const started = performance.now();
    const check = () => {
      if (signal?.aborted) throw abortError();
    };
    onProgress({ stage: "loading", progress: 0, message: "Loading video engine" });
    let info = await this.load((message) => onProgress({ stage: "loading", progress: 0, message }));
    check();
    const onAbort = () => this.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });

    onProgress({ stage: "preparing", progress: 0, message: "Preparing source files", engine: info });
    let mounted = await this.mountInputs(job.inputs);
    let nextSeq = 1;
    let tracks: Map<number, TrackTiming> | null = null;
    let ok = false;
    try {
      await job.beforeSegments?.(mounted.inputPath);
      check();
      for (const seg of job.segments) {
        check();
        const label = job.segments.length > 1 ? ` (part ${seg.index + 1}/${job.segments.length})` : "";
        let resumed = false;
        for (;;) {
          try {
            const result = await this.renderSegment(job, seg, mounted.inputPath, nextSeq, tracks, label, onProgress, check);
            nextSeq = result.nextSeq;
            tracks = result.tracks;
            break;
          } catch (e) {
            // A dead worker (watchdog) loses its FS, so the segment is prepared
            // again on a fresh engine. Everything already written to the sink is
            // kept: the render resumes from this part instead of starting over.
            if (!(e instanceof FFmpegHungError) || resumed || signal?.aborted) throw e;
            resumed = true;
            onProgress({ stage: "loading", progress: seg.start / job.duration, message: `Video engine stalled; restarting${e.multithreaded ? " single-threaded" : ""} from part ${seg.index + 1}` });
            info = await this.load((message) => onProgress({ stage: "loading", progress: seg.start / job.duration, message }));
            check();
            mounted = await this.mountInputs(job.inputs);
            onProgress({ stage: "preparing", progress: seg.start / job.duration, message: `Preparing${label}`, engine: info });
          }
        }
      }
      ok = true;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      throw error;
    } finally {
      signal?.removeEventListener("abort", onAbort);
      if (!signal?.aborted) await mounted.release();
      if (!ok) await job.sink.abort().catch(() => undefined);
    }
    onProgress({ stage: "done", progress: 1, message: "Done" });
    return { seconds: (performance.now() - started) / 1000, bytes: job.sink.bytes, segments: job.segments.length, info };
  }

  private async renderSegment(
    job: RenderJob,
    seg: RenderSegmentJob,
    inputPath: (name: string) => string,
    nextSeq: number,
    tracks: Map<number, TrackTiming> | null,
    label: string,
    onProgress: (p: RenderProgress) => void,
    check: () => void,
  ): Promise<{ nextSeq: number; tracks: Map<number, TrackTiming> | null }> {
    const output = `seg_${seg.index}.mp4`;
    const ctx: SegmentContext = { ffmpeg: this.instance, inputPath, output, temp: [] };
    try {
      onProgress({ stage: "preparing", progress: seg.start / job.duration, message: `Preparing${label}`, segment: seg.index, segments: job.segments.length });
      await seg.prepare?.(ctx);
      check();
      const args = seg.args(ctx);
      const segLen = seg.end - seg.start;
      onProgress({ stage: "encoding", progress: seg.start / job.duration, message: `Encoding${label}`, segment: seg.index, segments: job.segments.length });
      const code = await this.exec(args, (t) => {
        const p = Math.min(0.999, (seg.start + Math.min(segLen, t)) / job.duration);
        onProgress({ stage: "encoding", progress: p, message: `Encoding ${Math.round(p * 100)}%${label}`, segment: seg.index, segments: job.segments.length });
      });
      check();
      if (code !== 0) throw new Error(`ffmpeg exited with code ${code}${label}.\n${this.recentLogs()}`);
      onProgress({ stage: "writing", progress: seg.end / job.duration, message: `Writing${label}` });
      let data = (await this.instance.readFile(output)) as Uint8Array;
      if (job.fragmented) {
        if (seg.index === 0) {
          data = stripTrailingIndex(data);
          tracks = parseTrackTiming(data);
        } else {
          data = stripInitSegment(data);
          if (tracks) shiftFragments(data, seg.start, tracks);
        }
        nextSeq = renumberFragments(data, nextSeq);
      }
      await job.sink.write(data);
      return { nextSeq, tracks };
    } finally {
      if (this.ffmpeg) {
        await this.instance.deleteFile(output).catch(() => undefined);
        for (const t of ctx.temp) await this.instance.deleteFile(t).catch(() => undefined);
      }
    }
  }

  /** Terminates the worker; the next call to load() starts fresh. */
  cancel() {
    resetFFmpeg();
    this.ffmpeg = null;
    this.info = null;
  }
}

export const ffmpegEngine = new FFmpegEngine();
