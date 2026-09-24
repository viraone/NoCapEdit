/**
 * transcriptionEngine — WebGPU-accelerated Whisper transcription with
 * speaker identification, producing timeline-synced caption cues and
 * WebVTT / SRT sidecars.
 *
 * Pipeline (all on-device, inside the ML Web Worker):
 *   1. Whisper (Transformers.js + ONNX Runtime Web, device: "webgpu" when the
 *      browser exposes it, otherwise WASM) → word-level timestamps
 *   2. pyannote segmentation-3.0 → local speaker turns per 30 s window
 *   3. WeSpeaker ResNet34 embeddings + agglomerative clustering → global
 *      speaker identities ("Speaker 1", "Speaker 2", …)
 *   4. caption builder → cues that never cross a speaker change
 */
import type { CaptionCue, WordTiming } from "@/lib/models/project";
import { buildCues, type CaptionRules, CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { mlRequest, type MlProgress } from "@/lib/speech/mlClient";
import { transcribeSamples, type TranscribeOptions, type TranscribeResult } from "@/lib/speech/transcriber";
import { uid } from "@/lib/utils/id";

export interface SpeakerSegment {
  start: number;
  end: number;
  /** 0-based speaker index. */
  speaker: number;
}

export interface DiarizationResult {
  segments: SpeakerSegment[];
  speakers: number;
}

export interface TranscriptionEngineOptions extends TranscribeOptions {
  diarize?: boolean;
  maxSpeakers?: number;
}

export interface TranscriptionEngineResult extends TranscribeResult {
  speakers: SpeakerSegment[] | null;
  speakerCount: number;
  /** Set when diarization failed but transcription succeeded. */
  diarizationError?: string;
}

export const SPEAKER_COLORS = ["#facc15", "#38bdf8", "#f472b6", "#4ade80", "#fb923c", "#a78bfa", "#f87171", "#2dd4bf"];

export function speakerColor(index: number): string {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

export function speakerLabel(index: number | undefined): string {
  return index === undefined ? "" : `Speaker ${index + 1}`;
}

/** Runs speaker diarization on 16 kHz mono samples (timings relative to the samples). */
export function diarizeSamples(samples: Float32Array, opts: { maxSpeakers?: number; onProgress?: (p: MlProgress) => void; signal?: AbortSignal }): Promise<DiarizationResult> {
  const copy = new Float32Array(samples);
  return mlRequest<DiarizationResult>(
    (id) => ({ type: "diarize", id, audio: copy, maxSpeakers: opts.maxSpeakers ?? 6 }),
    opts.onProgress,
    opts.signal,
    [copy.buffer],
  );
}

/** Transcribes and (optionally) diarizes one stretch of audio. */
export async function transcribeWithSpeakers(samples: Float32Array, opts: TranscriptionEngineOptions): Promise<TranscriptionEngineResult> {
  const transcript = await transcribeSamples(samples, opts);
  if (!opts.diarize) return { ...transcript, speakers: null, speakerCount: 0 };
  try {
    const d = await diarizeSamples(samples, { maxSpeakers: opts.maxSpeakers, onProgress: opts.onProgress, signal: opts.signal });
    return { ...transcript, speakers: d.segments, speakerCount: d.speakers };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ...transcript, speakers: null, speakerCount: 0, diarizationError: e instanceof Error ? e.message : String(e) };
  }
}

/** Speaker with the largest overlap with [start, end], or undefined. */
export function speakerAt(segments: SpeakerSegment[], start: number, end: number): number | undefined {
  let best: { speaker: number; overlap: number } | null = null;
  for (const s of segments) {
    const overlap = Math.min(end, s.end) - Math.max(start, s.start);
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { speaker: s.speaker, overlap };
  }
  if (best) return best.speaker;
  // No overlap (tiny gaps): use the nearest segment within half a second.
  const mid = (start + end) / 2;
  let nearest: { speaker: number; d: number } | null = null;
  for (const s of segments) {
    const d = mid < s.start ? s.start - mid : mid > s.end ? mid - s.end : 0;
    if (d < 0.5 && (!nearest || d < nearest.d)) nearest = { speaker: s.speaker, d };
  }
  return nearest?.speaker;
}

/** Builds cues so that no cue spans two speakers, tagging each with its speaker. */
export function buildSpeakerCues(words: WordTiming[], segments: SpeakerSegment[] | null, rules: CaptionRules = CAPTION_RULES): CaptionCue[] {
  if (!segments || !segments.length) return buildCues(words, rules);
  const sorted = [...words].sort((a, b) => a.start - b.start);
  const runs: { speaker: number | undefined; words: WordTiming[] }[] = [];
  for (const w of sorted) {
    const speaker = speakerAt(segments, w.start, w.end);
    const last = runs[runs.length - 1];
    if (last && last.speaker === speaker) last.words.push(w);
    else runs.push({ speaker, words: [w] });
  }
  const cues: CaptionCue[] = [];
  for (const run of runs) {
    for (const cue of buildCues(run.words, rules)) cues.push(run.speaker === undefined ? cue : { ...cue, speaker: run.speaker });
  }
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) if (cues[i].end > cues[i + 1].start) cues[i].end = Math.max(cues[i].start, cues[i + 1].start);
  return cues;
}

/** Re-tags existing cues with speakers (keeps text and timing). */
export function assignSpeakers(cues: CaptionCue[], segments: SpeakerSegment[]): CaptionCue[] {
  return cues.map((c) => {
    const speaker = speakerAt(segments, c.start, c.end);
    return speaker === undefined ? { ...c, speaker: undefined } : { ...c, speaker };
  });
}

// ---------------------------------------------------------------------------
// WebVTT
// ---------------------------------------------------------------------------

function vttTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const f = ms % 1000;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${f.toString().padStart(3, "0")}`;
}

export interface VttOptions {
  /** Emit <hh:mm:ss.mmm> timestamp tags before each word for karaoke-style players. */
  karaoke?: boolean;
  /** Prefix cues with <v Speaker N>. */
  speakers?: boolean;
  translated?: boolean;
}

export function toWebVtt(cues: CaptionCue[], opts: VttOptions = {}): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const lines = ["WEBVTT", ""];
  sorted.forEach((c, i) => {
    const text = (opts.translated && c.translatedText?.trim() ? c.translatedText : c.text).trim();
    if (!text) return;
    let body = text;
    if (opts.karaoke && c.words && c.words.length && (!opts.translated || !c.translatedText)) {
      body = c.words.map((w, k) => (k === 0 ? w.text : `<${vttTime(w.start)}>${w.text}`)).join(" ");
    }
    if (opts.speakers && c.speaker !== undefined) body = `<v ${speakerLabel(c.speaker)}>${body}`;
    lines.push(String(i + 1), `${vttTime(c.start)} --> ${vttTime(c.end)}`, body, "");
  });
  return lines.join("\n");
}

/** SRT with optional speaker prefixes ("Speaker 1: …"). */
export function toSpeakerSrt(cues: CaptionCue[], translated = false): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  return sorted
    .map((c, i) => {
      const text = (translated && c.translatedText?.trim() ? c.translatedText : c.text).trim();
      const prefix = c.speaker !== undefined ? `${speakerLabel(c.speaker)}: ` : "";
      return `${i + 1}\n${vttTime(c.start).replace(".", ",")} --> ${vttTime(c.end).replace(".", ",")}\n${prefix}${text}\n`;
    })
    .join("\n");
}

export function makeCue(text: string, start: number, end: number, speaker?: number): CaptionCue {
  return { id: uid("cue"), start, end, text, anchor: null, ...(speaker === undefined ? {} : { speaker }) };
}
