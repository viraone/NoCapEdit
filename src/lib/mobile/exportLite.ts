/**
 * Mobile-lite export: burns captions into a video using only browser-native
 * pieces — a <video> element for decoding, a canvas for compositing,
 * WebCodecs (hardware H.264 / AAC) for encoding and mp4-muxer for the
 * container. No ffmpeg.wasm, no SharedArrayBuffer, no cross-origin
 * isolation, and memory stays flat, which is what makes it work on an
 * iPhone where the desktop pipeline runs out of memory or never gets
 * isolated.
 *
 * The video is played once at 1× (muted) and every presented frame is
 * captured with requestVideoFrameCallback, so an export takes about as
 * long as the clip. That is the trade for never decoding off the main
 * media path — iOS Safari only decodes reliably through <video>.
 *
 * Audio: the source track is decoded with Web Audio and re-encoded to AAC
 * with AudioEncoder. Browsers without AudioEncoder fall back to a small
 * single-threaded ffmpeg mux of the original audio.
 */
import { ArrayBufferTarget, Muxer, StreamTarget } from "mp4-muxer";
import type { CaptionCue, SubtitleStyle } from "@/lib/models/project";
import { CaptionLayer } from "@/lib/mobile/captionLayer";
import { isIOS, resampleLinear } from "@/lib/mobile/audio";
import { BlobFileSink } from "@/lib/mobile/blobFileSink";
import { cropRect, DEFAULT_REFRAME, outputFrame, placeWholeFrame, type Reframe } from "@/lib/mobile/reframe";

export interface LiteProgress {
  phase: "prepare" | "audio" | "video" | "mux";
  /** 0..1 within the phase, or null when indeterminate. */
  progress: number | null;
  message: string;
}

export interface LiteExportOptions {
  file: Blob;
  /** Audio already decoded by lib/mobile/audio.ts (planar, at its sampleRate).
   * When given, the file is not decoded again — which also matters on iOS,
   * where decodeAudioData can't read a video container at all. */
  audio?: { sampleRate: number; channels: Float32Array[] } | null;
  cues: CaptionCue[];
  style: SubtitleStyle;
  /** The <video> that plays the source; must be in the DOM (iOS decodes off-DOM videos lazily). */
  video: HTMLVideoElement;
  /** The canvas frames are composited on; shown to the user as the live render. */
  canvas: HTMLCanvasElement;
  /** Output shape and where the video sits inside it (lib/mobile/reframe.ts).
   * Omitted = the whole source frame. */
  reframe?: Reframe;
  /** Longest output edge in pixels. */
  maxEdge?: number;
  fps?: number;
  /** Long clips: write a fragmented MP4 in 4 MB chunks that are handed to
   * Blob storage as they are produced, so the finished file never sits in
   * the JS heap. Short clips keep the classic fast-start MP4. */
  streaming?: boolean;
  onProgress?: (p: LiteProgress) => void;
  signal?: AbortSignal;
}

export interface LiteExportResult {
  blob: Blob;
  width: number;
  height: number;
  audio: "aac" | "ffmpeg" | "none";
  seconds: number;
  /** Which exporter produced it: the WebCodecs decode pipeline
   * (lib/mobile/fastExport.ts) or this file's real-time playback capture. */
  engine: "fast" | "realtime";
  stats?: ExportStats;
}

/** Where the time went, for the on-screen export timer. */
export interface ExportStats {
  /** e.g. "3840×2160 hevc 60 fps HDR" */
  source: string;
  frames: number;
  /** Average milliseconds per frame. */
  msVideo: number;
  msCaptions: number;
  /** Everything outside the compositing callback: decode, encode, muxing, waiting. */
  msOther: number;
  captionRenders: number;
  /** Frames handed to the encoder as decoded, because nothing was drawn on them. */
  passthroughFrames?: number;
  /** WebGPU route: where the draw time went, ms per composited frame. */
  gpu?: { import: number; layers: number; submit: number; wait: number; pack: number };
}

/** decodeAudioData needs the whole file as an ArrayBuffer; past this it
 * costs more memory than the ffmpeg mux fallback. */
const WEB_AUDIO_MAX_BYTES = 120 * 1024 * 1024;

const H264_CANDIDATES = ["avc1.64002A", "avc1.640028", "avc1.4D402A", "avc1.42E02A", "avc1.42E01E"];

export interface LiteSupport {
  ok: boolean;
  reason?: string;
  audioEncoder: boolean;
}

/** Whether this browser can run the lite export at all. */
export async function checkLiteSupport(): Promise<LiteSupport> {
  if (typeof window === "undefined") return { ok: false, reason: "No window", audioEncoder: false };
  if (typeof VideoEncoder === "undefined") return { ok: false, reason: "This browser has no WebCodecs video encoder. Safari 16.4+, Chrome 94+ or Edge work.", audioEncoder: false };
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) {
    return { ok: false, reason: "This browser cannot capture video frames (requestVideoFrameCallback).", audioEncoder: false };
  }
  const codec = await pickVideoCodec(1080, 1920, 30);
  if (!codec) return { ok: false, reason: "No supported H.264 encoder configuration.", audioEncoder: false };
  return { ok: true, audioEncoder: typeof AudioEncoder !== "undefined" };
}

async function pickVideoCodec(width: number, height: number, fps: number): Promise<string | null> {
  for (const codec of H264_CANDIDATES) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ codec, width, height, framerate: fps, avc: { format: "avc" } });
      if (supported) return codec;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/** Output size: keep the source aspect, cap the long edge, keep it even. */
export function outputSize(srcW: number, srcH: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH));
  return { width: even(srcW * scale), height: even(srcH * scale) };
}

function loadMetadata(video: HTMLVideoElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = () => reject(new Error("This video could not be decoded by your browser."));
    video.onloadedmetadata = () => {
      video.onerror = null;
      resolve();
    };
    video.onerror = onError;
    video.src = url;
    video.load();
  });
}

/** Safari can report a null or negative chunk duration; mp4-muxer rejects
 * those, so every chunk goes in through the raw API with a sane one. */
function chunkBytes(chunk: EncodedVideoChunk | EncodedAudioChunk): Uint8Array {
  const data = new Uint8Array(chunk.byteLength);
  chunk.copyTo(data);
  return data;
}
function safeDuration(chunk: EncodedVideoChunk | EncodedAudioChunk, fallbackUs: number): number {
  const d = chunk.duration;
  return typeof d === "number" && Number.isFinite(d) && d >= 0 ? d : fallbackUs;
}

/** AAC-LC AudioSpecificConfig for the sample rate / channel count we
 * configured. Safari's AudioEncoder reports a decoderConfig.description
 * that is not this 2-byte form (ffmpeg reads it as "object type 0, 0
 * channels"), so the muxer is always given a synthesised one. */
const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function aacSpecificConfig(sampleRate: number, channels: number): Uint8Array {
  const freqIndex = AAC_RATES.indexOf(sampleRate);
  if (freqIndex === -1) throw new Error(`Unsupported AAC sample rate ${sampleRate}`);
  const objectType = 2; // AAC LC
  return new Uint8Array([(objectType << 3) | (freqIndex >> 1), ((freqIndex & 1) << 7) | (channels << 3)]);
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

function resampleTo(input: Float32Array, from: number, to: number): Float32Array {
  return resampleLinear(input, from, to);
}

/** Decodes the source audio to planar float PCM at the encoder's rate. */
async function decodeForExport(file: Blob, sampleRate: number): Promise<AudioBuffer | null> {
  try {
    const data = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 1, sampleRate);
    return await ctx.decodeAudioData(data);
  } catch {
    return null;
  }
}

export async function exportCaptionedVideo(opts: LiteExportOptions): Promise<LiteExportResult> {
  const { file, cues, style, video, canvas, signal } = opts;
  const fps = opts.fps ?? 30;
  const maxEdge = opts.maxEdge ?? 1920;
  const progress = (p: LiteProgress) => opts.onProgress?.(p);

  progress({ phase: "prepare", progress: null, message: "Preparing" });
  const url = URL.createObjectURL(file);
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await loadMetadata(video, url);
  throwIfAborted(signal);

  const reframe = opts.reframe ?? DEFAULT_REFRAME;
  const { width, height } = outputFrame(video.videoWidth, video.videoHeight, reframe, maxEdge);
  const crop = cropRect(video.videoWidth, video.videoHeight, reframe);
  const place = placeWholeFrame(video.videoWidth, video.videoHeight, crop, width, height);
  const duration = video.duration;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas is not available.");
  const frame = { width, height };
  const captions = new CaptionLayer(cues, style, frame);

  const codec = await pickVideoCodec(width, height, fps);
  if (!codec) throw new Error("No supported H.264 encoder configuration for this size.");

  // ---- audio (decode + AAC) ------------------------------------------------
  const AUDIO_RATE = 48000;
  let planar: Float32Array[] | null = null;
  let audioMode: LiteExportResult["audio"] = "none";
  if (typeof AudioEncoder !== "undefined") {
    if (opts.audio && opts.audio.channels.length) {
      planar = opts.audio.channels.slice(0, 2).map((ch) => resampleTo(ch, opts.audio!.sampleRate, AUDIO_RATE));
    } else if (opts.audio === undefined && !isIOS() && file.size <= WEB_AUDIO_MAX_BYTES) {
      // (iOS can't decodeAudioData a video container; there, and for big
      // files, the ffmpeg mux at the end adds the original audio instead.)
      progress({ phase: "audio", progress: null, message: "Decoding audio" });
      const decoded = await decodeForExport(file, AUDIO_RATE);
      if (decoded) {
        planar = [];
        for (let c = 0; c < Math.min(2, decoded.numberOfChannels); c++) planar.push(decoded.getChannelData(c));
      }
    }
    throwIfAborted(signal);
  }
  const channels = planar ? planar.length : 0;

  const memoryTarget = opts.streaming ? null : new ArrayBufferTarget();
  const fileSink = memoryTarget ? null : new BlobFileSink();
  const target =
    memoryTarget ??
    new StreamTarget({
      chunked: true,
      chunkSize: 4 * 1024 * 1024,
      onData: (data, position) => fileSink!.write(data, position),
    });
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: fps },
    ...(planar && channels > 0 ? { audio: { codec: "aac", numberOfChannels: channels, sampleRate: AUDIO_RATE } } : {}),
    // Streaming writes a *classic* MP4 (moov at the end) — a fragmented MP4
    // would keep memory flat too, but iOS Photos won't import one, so the
    // share sheet loses "Save Video".
    fastStart: memoryTarget ? "in-memory" : false,
    firstTimestampBehavior: "offset",
  });

  if (planar && channels > 0) {
    let audioError: Error | null = null;
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        try {
          const fixedMeta: EncodedAudioChunkMetadata | undefined = meta?.decoderConfig
            ? { ...meta, decoderConfig: { ...meta.decoderConfig, description: aacSpecificConfig(AUDIO_RATE, channels) } }
            : meta;
          // AAC frames are 1024 samples.
          muxer.addAudioChunkRaw(chunkBytes(chunk), chunk.type, chunk.timestamp, safeDuration(chunk, Math.round((1024 / AUDIO_RATE) * 1e6)), fixedMeta);
        } catch (e) {
          audioError = e instanceof Error ? e : new Error(String(e));
        }
      },
      error: (e) => {
        audioError = e;
      },
    });
    const audioConfig: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: AUDIO_RATE, numberOfChannels: channels, bitrate: 128_000 };
    const { supported } = await AudioEncoder.isConfigSupported(audioConfig).catch(() => ({ supported: false }));
    if (supported) {
      audioEncoder.configure(audioConfig);
      const total = planar[0].length;
      const CHUNK = AUDIO_RATE; // one second per AudioData
      const scratch = new Float32Array(CHUNK * channels);
      for (let offset = 0; offset < total; offset += CHUNK) {
        throwIfAborted(signal);
        const frames = Math.min(CHUNK, total - offset);
        for (let c = 0; c < channels; c++) {
          scratch.set(planar[c].subarray(offset, offset + frames), c * frames);
        }
        const data = new AudioData({
          format: "f32-planar",
          sampleRate: AUDIO_RATE,
          numberOfFrames: frames,
          numberOfChannels: channels,
          timestamp: Math.round((offset / AUDIO_RATE) * 1e6),
          data: scratch.subarray(0, frames * channels),
        });
        audioEncoder.encode(data);
        data.close();
        if (audioError) throw audioError;
        if (audioEncoder.encodeQueueSize > 16) await new Promise((r) => setTimeout(r, 10));
        progress({ phase: "audio", progress: Math.min(1, (offset + frames) / total), message: "Encoding audio" });
      }
      await audioEncoder.flush();
      audioEncoder.close();
      if (audioError) throw audioError;
      audioMode = "aac";
    } else {
      audioEncoder.close();
      planar = null;
    }
  }

  // ---- video (play once, capture every presented frame) --------------------
  const frameUs = Math.round(1e6 / fps);
  let videoError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunkRaw(chunkBytes(chunk), chunk.type, chunk.timestamp, safeDuration(chunk, frameUs), meta);
      } catch (e) {
        videoError = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => {
      videoError = e;
    },
  });
  const bitrate = Math.min(12_000_000, Math.max(2_500_000, Math.round(width * height * fps * 0.1)));
  const videoConfig: VideoEncoderConfig = {
    codec,
    width,
    height,
    framerate: fps,
    bitrate,
    latencyMode: "quality",
    avc: { format: "avc" },
  };
  try {
    encoder.configure({ ...videoConfig, hardwareAcceleration: "prefer-hardware" });
  } catch {
    encoder.configure(videoConfig);
  }

  const keyEvery = fps * 2;
  let frameIndex = 0;
  let lastTimestamp = -1;

  await new Promise<void>((resolve, reject) => {
    let done = false;
    const finish = (err?: unknown) => {
      if (done) return;
      done = true;
      video.pause();
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => finish(new DOMException("Export cancelled", "AbortError"));
    signal?.addEventListener("abort", onAbort, { once: true });

    /** Composites and encodes the frame currently shown by the video at media time `t`. */
    const capture = (t: number) => {
      if (videoError) return finish(videoError);
      const timestamp = Math.round(t * 1e6);
      if (timestamp <= lastTimestamp) return;
      ctx.drawImage(video, place.dx, place.dy, place.dw, place.dh);
      captions.draw(ctx, t);
      // Skip a frame rather than stall playback when the encoder is behind.
      if (encoder.encodeQueueSize < 12) {
        const vf = new VideoFrame(canvas, { timestamp, duration: frameUs });
        encoder.encode(vf, { keyFrame: frameIndex % keyEvery === 0 });
        vf.close();
        frameIndex += 1;
        lastTimestamp = timestamp;
      }
      progress({ phase: "video", progress: duration ? Math.min(1, t / duration) : null, message: "Rendering" });
    };

    // Primary: one callback per presented frame, with its exact media time.
    let rvfcFrames = 0;
    const tick: VideoFrameRequestCallback = (_now, meta) => {
      if (done) return;
      rvfcFrames += 1;
      capture(meta.mediaTime);
      video.requestVideoFrameCallback(tick);
    };
    // Fallback: iOS Safari stops firing requestVideoFrameCallback after a
    // seek while paused (a re-export of the same clip does exactly that).
    // If no frame callback has arrived, sample currentTime from rAF instead.
    const minStep = 0.75 / fps;
    const rafTick = () => {
      if (done) return;
      if (rvfcFrames === 0 && !video.paused && !video.ended) {
        const t = video.currentTime;
        if (t - lastTimestamp / 1e6 >= minStep) capture(t);
      }
      requestAnimationFrame(rafTick);
    };

    video.onended = () => finish();
    video.onerror = () => finish(new Error("Playback failed during export."));
    if (video.currentTime !== 0) video.currentTime = 0;
    video.requestVideoFrameCallback(tick);
    requestAnimationFrame(rafTick);
    video.play().catch((e) => finish(e));
  });

  progress({ phase: "mux", progress: null, message: "Finishing" });
  await encoder.flush();
  encoder.close();
  if (videoError) throw videoError;
  muxer.finalize();
  URL.revokeObjectURL(url);

  let blob = memoryTarget ? new Blob([memoryTarget.buffer], { type: "video/mp4" }) : fileSink!.finalize();

  // No AudioEncoder (or unsupported config): keep the original audio via a
  // tiny ffmpeg mux. Single-threaded on purpose — no isolation needed.
  if (audioMode === "none") {
    try {
      progress({ phase: "mux", progress: null, message: "Adding audio" });
      blob = await muxOriginalAudio(blob, file);
      audioMode = "ffmpeg";
    } catch (e) {
      console.warn("Audio mux fallback failed; exporting video only", e);
    }
  }

  return { blob, width, height, audio: audioMode, seconds: duration, engine: "realtime" };
}

async function muxOriginalAudio(videoOnly: Blob, source: Blob): Promise<Blob> {
  const [{ loadFFmpeg }, { FFFSType }] = await Promise.all([import("@/lib/ffmpeg/loader"), import("@ffmpeg/ffmpeg")]);
  const { ffmpeg } = await loadFFmpeg({ forceSingleThread: true });
  // Both inputs are read through a WORKERFS mount (streamed, not copied
  // into wasm memory) — the source can be hundreds of MB on a phone.
  const mount = "/lite-mux";
  await ffmpeg.createDir(mount).catch(() => undefined);
  await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: "video.mp4", data: videoOnly }, { name: "source", data: source }] }, mount);
  try {
    const code = await ffmpeg.exec([
      "-i", `${mount}/video.mp4`,
      "-i", `${mount}/source`,
      "-map", "0:v:0",
      "-map", "1:a:0?",
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "128k",
      "-shortest",
      "-movflags", "+faststart",
      "lite-out.mp4",
    ]);
    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);
    const out = await ffmpeg.readFile("lite-out.mp4");
    const bytes = typeof out === "string" ? new TextEncoder().encode(out) : out;
    return new Blob([bytes as BlobPart], { type: "video/mp4" });
  } finally {
    await Promise.allSettled([ffmpeg.deleteFile("lite-out.mp4"), ffmpeg.unmount(mount).then(() => ffmpeg.deleteDir(mount))]);
  }
}
