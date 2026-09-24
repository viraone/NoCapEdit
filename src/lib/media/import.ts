/** Import flows: everything is stored in IndexedDB on the user's device. */
import { createClip, type Clip } from "@/lib/models/project";
import { putAsset, putPeaks, putThumbs, putProjectThumb } from "@/lib/storage/db";
import { uid } from "@/lib/utils/id";
import { decodeAudio, peaksFromSamples } from "@/lib/ffmpeg/waveform";
import { probeAudio, probeImage, probeVideo } from "./probe";
import { captureFrame, generateFilmstrip } from "./thumbnails";
import { emitAssetReady } from "./events";

const MAX_DECODE_BYTES = 1_200_000_000;

export interface ImportedVideo {
  clip: Clip;
  assetId: string;
  blob: Blob;
}

export async function importVideo(
  file: File,
  projectId: string,
  onStatus?: (message: string) => void,
): Promise<ImportedVideo> {
  onStatus?.(`Reading ${file.name}`);
  const info = await probeVideo(file);
  const assetId = uid("asset");
  await putAsset({ id: assetId, projectId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() });

  onStatus?.("Analysing audio and frames");
  let hasAudio = true;
  const audioTask = (async () => {
    if (file.size > MAX_DECODE_BYTES) return;
    const decoded = await decodeAudio(file).catch(() => null);
    if (!decoded) {
      hasAudio = false;
      return;
    }
    const peaks = peaksFromSamples(decoded.samples, decoded.sampleRate, 50);
    await putPeaks({ assetId, peaks: peaks.peaks, perSecond: peaks.perSecond, duration: peaks.duration });
    emitAssetReady("peaks", assetId);
  })();
  const thumbTask = generateFilmstrip(assetId, file, info.duration)
    .then(async (rec) => {
      await putThumbs(rec);
      emitAssetReady("thumbs", assetId);
    })
    .catch(() => undefined);
  await Promise.all([audioTask, thumbTask]);

  const clip = createClip({
    assetId,
    name: file.name.replace(/\.[^.]+$/, ""),
    duration: info.duration,
    width: info.width,
    height: info.height,
    hasAudio,
  });
  return { clip, assetId, blob: file };
}

export async function importImage(file: File, projectId: string): Promise<{ assetId: string; aspect: number; name: string; blob: Blob }> {
  const size = await probeImage(file);
  const assetId = uid("asset");
  await putAsset({ id: assetId, projectId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() });
  return { assetId, aspect: size.width / Math.max(1, size.height), name: file.name.replace(/\.[^.]+$/, ""), blob: file };
}

export async function importAudio(file: File, projectId: string): Promise<{ assetId: string; duration: number; name: string; blob: Blob }> {
  const { duration } = await probeAudio(file);
  const assetId = uid("asset");
  await putAsset({ id: assetId, projectId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() });
  return { assetId, duration, name: file.name.replace(/\.[^.]+$/, ""), blob: file };
}

/** Saves a poster frame for the project card on the start screen. */
export async function updateProjectThumbnail(projectId: string, blob: Blob, time: number) {
  try {
    const frame = await captureFrame(blob, time);
    await putProjectThumb(projectId, frame);
  } catch {
    /* thumbnails are cosmetic */
  }
}
