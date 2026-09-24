/**
 * Client-side Whisper wrapper. Audio is decoded with the Web Audio API,
 * sliced to the clip's trim range and sent to the ML worker, which runs the
 * ONNX model with Transformers.js (WebGPU or WASM). Word timings come back in
 * clip-source seconds and are mapped onto the project timeline here.
 */
import type { WordTiming } from "@/lib/models/project";
import type { ClipLayout } from "@/lib/models/timeline";
import { toProjectTime } from "@/lib/models/timeline";
import { SPEECH_SAMPLE_RATE } from "@/lib/ffmpeg/waveform";
import { mlRequest, type MlProgress } from "./mlClient";

export interface WhisperModel {
  id: string;
  name: string;
  size: string;
  note: string;
}

export const WHISPER_MODELS: WhisperModel[] = [
  { id: "onnx-community/whisper-tiny_timestamped", name: "Whisper Tiny", size: "~45 MB", note: "Fastest, rough accuracy" },
  { id: "onnx-community/whisper-base_timestamped", name: "Whisper Base", size: "~80 MB", note: "Good balance" },
  { id: "onnx-community/whisper-small_timestamped", name: "Whisper Small", size: "~250 MB", note: "Accurate, slower on WASM" },
  { id: "onnx-community/whisper-large-v3-turbo_timestamped", name: "Whisper Large v3 Turbo", size: "~600 MB", note: "Best accuracy, needs WebGPU" },
];

export const DEFAULT_WHISPER_MODEL = WHISPER_MODELS[1].id;

export type DevicePreference = "auto" | "webgpu" | "wasm";

export interface TranscribeResult {
  words: WordTiming[];
  text: string;
  device: "webgpu" | "wasm";
}

export async function hasWebGPU(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

/** Cuts [start, end] seconds out of 16 kHz samples. */
export function sliceSamples(samples: Float32Array, start: number, end: number, sampleRate = SPEECH_SAMPLE_RATE): Float32Array {
  const from = Math.max(0, Math.floor(start * sampleRate));
  const to = Math.min(samples.length, Math.ceil(end * sampleRate));
  return samples.slice(from, Math.max(from, to));
}

export interface TranscribeOptions {
  model: string;
  language: string;
  device: DevicePreference;
  onProgress?: (p: MlProgress) => void;
  signal?: AbortSignal;
}

/** Transcribes 16 kHz mono samples; timings are relative to the samples. */
export function transcribeSamples(samples: Float32Array, opts: TranscribeOptions): Promise<TranscribeResult> {
  const copy = new Float32Array(samples);
  return mlRequest<TranscribeResult>(
    (id) => ({ type: "transcribe", id, audio: copy, model: opts.model, language: opts.language, device: opts.device }),
    opts.onProgress,
    opts.signal,
    [copy.buffer],
  );
}

/** Maps word timings from clip-source seconds (offset from inPoint) to project time. */
export function wordsToProjectTime(words: WordTiming[], layout: ClipLayout): WordTiming[] {
  const { clip } = layout;
  return words
    .map((w) => ({
      text: w.text,
      start: toProjectTime(layout, clip.inPoint + w.start),
      end: toProjectTime(layout, clip.inPoint + w.end),
    }))
    .filter((w) => w.start < layout.end + 0.01)
    .map((w) => ({ ...w, end: Math.min(w.end, layout.end) }));
}
