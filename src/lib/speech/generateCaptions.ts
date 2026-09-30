/**
 * Captions for a whole project, generated on this device: every clip's audio
 * is decoded, transcribed (and optionally diarized) inside the ML worker,
 * and the words are placed in project time and grouped into cues. Shared by
 * the Subtitles panel (with the settings the user picked there) and the
 * Reels panel's "Do this for me" (with the defaults).
 */
import type { CaptionCue, Clip, VideoProject, WordTiming } from "@/lib/models/project";
import { layoutClips, toProjectTime } from "@/lib/models/timeline";
import { getAsset } from "@/lib/storage/db";
import { getSpeechAudio } from "./audioCache";
import { buildCues, cuesEditedSince, sortCues, type CaptionRules } from "./captionBuilder";
import { sliceSamples, wordsToProjectTime, type DevicePreference } from "./transcriber";
import { buildSpeakerCues, transcribeWithSpeakers, type SpeakerSegment } from "@/lib/transcriptionEngine";

export interface CaptionJobProgress {
  message: string;
  progress: number | null;
  /** Text recognised so far in the current clip. */
  partial?: string;
}

export interface GenerateCaptionsOptions {
  clips: Clip[];
  model: string;
  language: string;
  device: DevicePreference;
  diarize: boolean;
  maxSpeakers: number;
  rules: CaptionRules;
  signal?: AbortSignal;
  onProgress?: (p: CaptionJobProgress) => void;
}

export interface GeneratedCaptions {
  cues: CaptionCue[];
  wordCount: number;
  /** Compute backend the transcription ran on ("webgpu", "wasm"), when known. */
  device: string;
  speakerCount: number;
  /** Speaker turns were found (the caption style may colour by speaker). */
  hasSpeakers: boolean;
  /** Set when diarization failed but transcription succeeded. */
  diarizationNote: string;
}

/** True when at least one clip has an audio track to transcribe. */
export function hasSpeechTrack(clips: Clip[]): boolean {
  return clips.some((c) => c.hasAudio);
}

/**
 * Transcribes every clip and builds captions in project time. Resolves to
 * null when no speech was found. Rejects with an AbortError when cancelled.
 */
export async function generateCaptions(o: GenerateCaptionsOptions): Promise<GeneratedCaptions | null> {
  const layouts = layoutClips(o.clips);
  const words: WordTiming[] = [];
  const segments: SpeakerSegment[] = [];
  let speakerOffset = 0;
  let device = "";
  let diarizationNote = "";
  for (const [i, layout] of layouts.entries()) {
    const prefix = layouts.length > 1 ? `Clip ${i + 1}/${layouts.length}: ` : "";
    o.onProgress?.({ message: `${prefix}Decoding audio`, progress: null });
    const asset = await getAsset(layout.clip.assetId);
    if (!asset) continue;
    const audio = await getSpeechAudio(asset.id, asset.blob);
    if (!audio) continue;
    const samples = sliceSamples(audio.samples, layout.clip.inPoint, layout.clip.outPoint, audio.sampleRate);
    if (samples.length < audio.sampleRate * 0.3) continue;
    const result = await transcribeWithSpeakers(samples, {
      model: o.model,
      language: o.language,
      device: o.device,
      diarize: o.diarize,
      maxSpeakers: o.maxSpeakers,
      signal: o.signal,
      onProgress: (p) => o.onProgress?.({ message: `${prefix}${p.message}`, progress: p.progress, partial: p.partialText }),
    });
    device = result.device;
    words.push(...wordsToProjectTime(result.words, layout));
    if (result.speakers) {
      for (const s of result.speakers) {
        segments.push({
          start: toProjectTime(layout, layout.clip.inPoint + s.start),
          end: toProjectTime(layout, layout.clip.inPoint + s.end),
          speaker: s.speaker + speakerOffset,
        });
      }
      speakerOffset += result.speakerCount;
    }
    if (result.diarizationError) diarizationNote = ` Speaker detection failed: ${result.diarizationError}`;
  }
  if (!words.length) return null;
  const cues = o.diarize ? buildSpeakerCues(words, segments.length ? segments : null, o.rules) : buildCues(words, o.rules);
  const speakerCount = new Set(cues.map((c) => c.speaker).filter((s) => s !== undefined)).size;
  return { cues, wordCount: words.length, device, speakerCount, hasSpeakers: segments.length > 0, diarizationNote };
}

/**
 * Puts generated captions on a draft project. Captions edited or imported
 * since `cuesAtStart` (while the job ran) are kept alongside the new ones;
 * returns how many. Undo reverts the whole step.
 */
export function applyGeneratedCaptions(p: VideoProject, cuesAtStart: CaptionCue[], g: GeneratedCaptions, language: string, diarize: boolean): number {
  const edited = cuesEditedSince(cuesAtStart, p.cues);
  p.cues = edited.length ? sortCues([...edited, ...g.cues]) : g.cues;
  p.captions.sourceLanguage = language;
  if (diarize && g.hasSpeakers) p.subtitleStyle.speakerColors = true;
  return edited.length;
}
