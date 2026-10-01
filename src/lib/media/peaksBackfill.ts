/**
 * Waveform peaks for assets that do not have them yet. Import skips very
 * large files to stay fast, and cleaned-up audio and cut reels are new assets
 * that never went through import, so the timeline fills the gaps here: one
 * asset at a time, in the background, once per page load.
 */
import { getAsset, getPeaks } from "@/lib/storage/db";
import { getSpeechAudio } from "@/lib/speech/audioCache";
import { savePeaksIfMissing } from "./savePeaks";

/** Above this the whole file has to sit in memory to be decoded, which browsers refuse or crash on. */
export const MAX_BACKFILL_BYTES = 2_000_000_000;

export type BackfillResult = "ready" | "no-audio" | "too-large" | "missing";

const jobs = new Map<string, Promise<BackfillResult>>();
let queue: Promise<unknown> = Promise.resolve();

async function backfill(assetId: string): Promise<BackfillResult> {
  if (await getPeaks(assetId)) return "ready";
  const asset = await getAsset(assetId);
  if (!asset?.blob) return "missing";
  if (asset.blob.size > MAX_BACKFILL_BYTES) return "too-large";
  // Shares the decode with captions: a later "Generate captions" reuses it.
  const decoded = await getSpeechAudio(assetId, asset.blob);
  if (!decoded) return "no-audio";
  await savePeaksIfMissing(assetId, decoded);
  return "ready";
}

/** Makes sure the asset has waveform peaks; resolves once they are stored (or cannot be). */
export function ensurePeaks(assetId: string): Promise<BackfillResult> {
  const running = jobs.get(assetId);
  if (running) return running;
  // Decodes run one after another: two big files at once could exhaust memory.
  const job = queue.then(() => backfill(assetId)).catch((): BackfillResult => "no-audio");
  queue = job;
  jobs.set(assetId, job);
  return job;
}
