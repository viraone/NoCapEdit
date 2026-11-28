import { findLaughMoments, pickBiggest, toSoundFrame, type SoundFrame } from "./laughMoments";
import { getSpeechAudio } from "@/lib/speech/audioCache";
import { getAsset } from "@/lib/storage/db";
import { layoutClips, toProjectTime } from "@/lib/models/timeline";
import { withBase } from "@/lib/basePath";
import { whileBusy } from "@/lib/utils/busy";
import type { Clip } from "@/lib/models/project";

export const YAMNET_URL = "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite";
export const SOUND_NAMES = ["Laughter", "Baby laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle, chortle", "Applause", "Clapping"];

export interface Laugh {
  id: string;
  clipId: string;
  start: number;
  end: number;
  score: number;
}

export interface FindLaughsOptions {
  clips: Clip[];
  signal?: AbortSignal;
  onProgress?: (message: string, progress: number | null) => void;
}

const CHUNK = 15600 * 60;
const SAMPLE_RATE = 16000;

export function findLaughs(options: FindLaughsOptions): Promise<Laugh[]> {
  return whileBusy(() => findLaughsInner(options));
}

async function findLaughsInner(options: FindLaughsOptions): Promise<Laugh[]> {
  const { clips, signal, onProgress } = options;

  if (!clips.some((c) => c.hasAudio)) {
    throw new Error("None of the clips has sound, so there are no laughs to find.");
  }

  const layouts = layoutClips(clips);
  const allMoments: { start: number; end: number; score: number; clipId: string; id: string }[] = [];
  let classifier: { classify: (samples: Float32Array, sampleRate: number) => { timestampMs?: number; classifications: { categories: { categoryName: string; score: number }[] }[] }[]; close: () => void } | null = null;
  let classifierLoaded = false;

  try {
    for (const layout of layouts) {
      const clip = layout.clip;
      if (!clip.hasAudio) {
        continue;
      }

      onProgress?.("Reading the sound", null);
      const asset = await getAsset(clip.assetId);
      if (!asset) {
        continue;
      }

      const audio = await getSpeechAudio(asset.id, asset.blob, (f) => onProgress?.("Reading the sound", f));
      if (signal?.aborted) {
        throw new DOMException("Cancelled", "AbortError");
      }
      if (!audio) {
        throw new Error("This video's sound could not be read.");
      }

      if (!classifierLoaded) {
        onProgress?.("Loading the laugh model", null);
        try {
          const { FilesetResolver, AudioClassifier } = await import("@mediapipe/tasks-audio");
          const files = await FilesetResolver.forAudioTasks(withBase("/mediapipe/wasm"));
          classifier = await AudioClassifier.createFromOptions(files, {
            baseOptions: { modelAssetPath: YAMNET_URL },
            categoryAllowlist: SOUND_NAMES,
          });
          classifierLoaded = true;
        } catch {
          throw new Error("The laugh model could not be loaded. It is downloaded the first time, so check the internet connection.");
        }
      }

      if (!classifier) {
        throw new Error("The laugh model could not be loaded. It is downloaded the first time, so check the internet connection.");
      }

      const startSample = Math.floor(clip.inPoint * SAMPLE_RATE);
      const endSample = Math.ceil(clip.outPoint * SAMPLE_RATE);
      const clipSamples = audio.samples.subarray(startSample, endSample);
      const totalSamples = clipSamples.length;
      const frames: SoundFrame[] = [];

      for (let offset = 0; offset < totalSamples; offset += CHUNK) {
        const chunk = clipSamples.subarray(offset, Math.min(offset + CHUNK, totalSamples));
        if (chunk.length < SAMPLE_RATE) {
          continue;
        }

        const results = classifier.classify(chunk, SAMPLE_RATE);
        for (const result of results) {
          const time = clip.inPoint + offset / SAMPLE_RATE + (result.timestampMs ?? 0) / 1000;
          frames.push(toSoundFrame(time, result.classifications[0]?.categories ?? []));
        }

        const fraction = Math.min(1, (offset + chunk.length) / totalSamples);
        onProgress?.("Listening for laughs", fraction);
        await new Promise((r) => setTimeout(r, 0));
        if (signal?.aborted) {
          throw new DOMException("Cancelled", "AbortError");
        }
      }

      const moments = findLaughMoments(frames, { threshold: 0.1, frameLength: 0.975 });
      for (const m of moments) {
        allMoments.push({
          start: toProjectTime(layout, m.start),
          end: toProjectTime(layout, Math.min(m.end, clip.outPoint)),
          score: m.score,
          clipId: clip.id,
          id: `${clip.id}:${m.start.toFixed(2)}`,
        });
      }
    }

    const best = pickBiggest(allMoments, 30, 20);
    return best.sort((a, b) => b.score - a.score).map((m) => {
      const moment = m as typeof m & { id: string; clipId: string };
      return {
        id: moment.id,
        clipId: moment.clipId,
        start: moment.start,
        end: moment.end,
        score: moment.score,
      };
    });
  } finally {
    if (classifier) {
      classifier.close();
    }
  }
}
