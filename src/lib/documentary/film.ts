/**
 * Turns a documentary script into an MP4 on the visitor's device: the in-browser voice
 * narrates every scene, the scenes are drawn frame by frame on a canvas (draw.ts), and
 * WebCodecs encodes video and audio into one file. Nothing is uploaded.
 */
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { parseWav, resampleLinear } from "@/lib/mobile/audio";
import { isKokoroVoice, speakKokoro } from "@/lib/speech/kokoro";
import { synthesizeSpeech } from "@/lib/speech/tts";
import { drawFilmFrame } from "./draw";
import type { DocScript } from "./script";
import { buildTimeline, FPS, splitSentences, type FilmTimeline } from "./timeline";

export const FILM_AUDIO_RATE = 48_000;
export type FilmHeight = 720 | 1080;

export type FilmPhase = "voice" | "video" | "finish";
export interface FilmProgress {
  phase: FilmPhase;
  /** 0 to 1 within the phase. */
  progress: number;
  message: string;
}

export interface FilmOptions {
  script: DocScript;
  /** A voice id from TTS_VOICES. */
  voice: string;
  height: FilmHeight;
  /** Draws each frame: the documentary look when left out, drawAnimationFrame for the animation style. */
  draw?: typeof drawFilmFrame;
  onProgress?: (p: FilmProgress) => void;
  signal?: AbortSignal;
}

export interface FilmResult {
  blob: Blob;
  duration: number;
  width: number;
  height: number;
  /** When each scene starts and ends, so a chat can tell which scene a playback time is in. */
  timeline: FilmTimeline;
}

export function filmSupported(): boolean {
  return typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined" && typeof AudioData !== "undefined";
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** The two-byte AAC-LC config the MP4 needs; Safari's encoder leaves it out. */
function aacSpecificConfig(rate: number, channels: number): Uint8Array {
  const v = (2 << 11) | (Math.max(0, AAC_RATES.indexOf(rate)) << 7) | (channels << 3);
  return new Uint8Array([v >> 8, v & 255]);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** One scene's narration as 48 kHz mono samples, sentence by sentence with a short breath between. */
async function narrate(text: string, voice: string, signal?: AbortSignal): Promise<Float32Array> {
  const parts: Float32Array[] = [];
  const breath = new Float32Array(Math.round(FILM_AUDIO_RATE * 0.22));
  for (const piece of splitSentences(text)) {
    throwIfAborted(signal);
    let raw: Float32Array;
    let rate: number;
    if (isKokoroVoice(voice)) {
      const spoken = await speakKokoro(piece, voice, undefined, signal);
      raw = spoken.audio;
      rate = spoken.sampleRate;
    } else {
      const spoken = await synthesizeSpeech(piece, voice, undefined, signal);
      const wav = parseWav(new Uint8Array(await spoken.blob.arrayBuffer()));
      raw = wav.channels[0];
      rate = wav.sampleRate;
    }
    const samples = resampleLinear(raw, rate, FILM_AUDIO_RATE);
    let peak = 0;
    for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
    const gain = peak > 0 ? 0.85 / peak : 1;
    const out = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) out[i] = samples[i] * gain;
    parts.push(out, breath);
  }
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  return all;
}

async function pickVideoConfig(width: number, height: number): Promise<VideoEncoderConfig> {
  // Flat graphics and text compress far better than camera footage.
  const bitrate = height >= 1080 ? 5_000_000 : 2_500_000;
  for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42002a", "avc1.42001f"]) {
    const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: FPS };
    const { supported } = await VideoEncoder.isConfigSupported(config).catch(() => ({ supported: false }));
    if (supported) return config;
  }
  throw new Error("This browser can't make videos here. Try Chrome, Edge or Safari.");
}

export async function renderFilm(opts: FilmOptions): Promise<FilmResult> {
  const { script, voice, signal } = opts;
  const draw = opts.draw ?? drawFilmFrame;
  const progress = (p: FilmProgress) => opts.onProgress?.(p);
  if (!filmSupported()) throw new Error("This browser can't make videos here. Try Chrome, Edge or Safari.");

  // 1. Narration, scene by scene: it decides how long each scene lasts.
  const speech: Float32Array[] = [];
  for (let i = 0; i < script.scenes.length; i++) {
    progress({ phase: "voice", progress: i / script.scenes.length, message: `Recording the narrator, scene ${i + 1} of ${script.scenes.length}${i === 0 ? " (the first time downloads the voice, about 90 MB)" : ""}` });
    speech.push(await narrate(script.scenes[i].narration, voice, signal));
  }
  progress({ phase: "voice", progress: 1, message: "Narration recorded" });
  const tl = buildTimeline(script.scenes, speech.map((s) => s.length / FILM_AUDIO_RATE));

  const track = new Float32Array(Math.ceil(tl.total * FILM_AUDIO_RATE));
  tl.scenes.forEach((timing, i) => track.set(speech[i].subarray(0, Math.max(0, track.length - Math.round(timing.speechStart * FILM_AUDIO_RATE))), Math.round(timing.speechStart * FILM_AUDIO_RATE)));

  // 2. The MP4 container, video and audio encoders.
  const height = opts.height;
  const width = Math.round((height * 16) / 9);
  const videoConfig = await pickVideoConfig(width, height);
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width, height, frameRate: FPS },
    audio: { codec: "aac", numberOfChannels: 1, sampleRate: FILM_AUDIO_RATE },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });
  let failure: Error | null = null;
  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      try {
        const fixed = meta?.decoderConfig ? { ...meta, decoderConfig: { ...meta.decoderConfig, description: aacSpecificConfig(FILM_AUDIO_RATE, 1) } } : meta;
        muxer.addAudioChunk(chunk, fixed);
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => {
      failure = e;
    },
  });
  const audioConfig: AudioEncoderConfig = { codec: "mp4a.40.2", sampleRate: FILM_AUDIO_RATE, numberOfChannels: 1, bitrate: 96_000 };
  const audioOk = await AudioEncoder.isConfigSupported(audioConfig).then((r) => !!r.supported).catch(() => false);
  if (!audioOk) throw new Error("This browser can't encode the narration. Try Chrome, Edge or Safari.");
  audioEncoder.configure(audioConfig);
  for (let offset = 0; offset < track.length; offset += FILM_AUDIO_RATE) {
    throwIfAborted(signal);
    const frames = Math.min(FILM_AUDIO_RATE, track.length - offset);
    const data = new AudioData({ format: "f32-planar", sampleRate: FILM_AUDIO_RATE, numberOfFrames: frames, numberOfChannels: 1, timestamp: Math.round((offset / FILM_AUDIO_RATE) * 1e6), data: track.subarray(offset, offset + frames) });
    audioEncoder.encode(data);
    data.close();
    if (failure) throw failure;
    if (audioEncoder.encodeQueueSize > 16) await tick();
  }
  await audioEncoder.flush();
  audioEncoder.close();
  if (failure) throw failure;

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      try {
        muxer.addVideoChunk(chunk, meta);
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      }
    },
    error: (e) => {
      failure = e;
    },
  });
  videoEncoder.configure(videoConfig);

  // 3. Draw and encode every frame.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser can't draw the film.");
  const frameCount = Math.ceil(tl.total * FPS);
  const frameUs = Math.round(1e6 / FPS);
  for (let i = 0; i < frameCount; i++) {
    throwIfAborted(signal);
    draw(ctx, width, height, script, tl, i / FPS);
    const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / FPS), duration: frameUs });
    videoEncoder.encode(frame, { keyFrame: i % (FPS * 2) === 0 });
    frame.close();
    if (failure) throw failure;
    if (videoEncoder.encodeQueueSize > 8) await tick();
    if (i % 15 === 0) {
      progress({ phase: "video", progress: i / frameCount, message: `Drawing the film, ${Math.round((i / frameCount) * 100)}%` });
      await tick();
    }
  }
  await videoEncoder.flush();
  videoEncoder.close();
  if (failure) throw failure;

  progress({ phase: "finish", progress: 0.5, message: "Finishing the file" });
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: "video/mp4" });
  progress({ phase: "finish", progress: 1, message: "Done" });
  return { blob, duration: tl.total, width, height, timeline: tl };
}
