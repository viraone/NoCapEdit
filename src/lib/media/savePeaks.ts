import { getPeaks, putPeaks } from "@/lib/storage/db";
import { peaksFromSamples, type DecodedAudio } from "@/lib/ffmpeg/waveform";
import { emitAssetReady } from "./events";

/** Same density import uses. */
const PEAKS_PER_SECOND = 50;

const saving = new Map<string, Promise<void>>();

async function save(assetId: string, decoded: DecodedAudio): Promise<void> {
  if (await getPeaks(assetId)) return;
  const peaks = peaksFromSamples(decoded.samples, decoded.sampleRate, PEAKS_PER_SECOND);
  await putPeaks({ assetId, peaks: peaks.peaks, perSecond: peaks.perSecond, duration: peaks.duration });
  emitAssetReady("peaks", assetId);
}

/** Stores waveform peaks from audio already decoded for another reason, when the asset has none yet. */
export function savePeaksIfMissing(assetId: string, decoded: DecodedAudio): Promise<void> {
  const running = saving.get(assetId);
  if (running) return running;
  const job = save(assetId, decoded).finally(() => saving.delete(assetId));
  saving.set(assetId, job);
  return job;
}
