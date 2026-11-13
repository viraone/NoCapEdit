/** Import flows: everything is stored in IndexedDB on the user's device. */
import { createClip, type AudioStatus, type Clip } from "@/lib/models/project";
import { putAsset, putPeaks, putThumbs, putProjectThumb } from "@/lib/storage/db";
import { uid } from "@/lib/utils/id";
import { decodeAudio, peaksFromSamples } from "@/lib/ffmpeg/waveform";
import { audioStatusFor, findAudioTrack } from "./audioStatus";
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
  /** Pre-allocated id, so the caller can protect the asset before it is written. */
  assetId: string = uid("asset"),
  /** A picture made into a silent video: no sound to read and one frame to copy, so the import skips both. */
  still = false,
): Promise<ImportedVideo> {
  onStatus?.(`Reading ${file.name}`);
  const info = await probeVideo(file);
  await putAsset({ id: assetId, projectId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: Date.now() });

  onStatus?.("Analysing audio and frames");
  let hasAudio = true;
  let audioStatus: AudioStatus = "ok";
  let audioError: string | undefined;
  let previewUnavailable = false;
  const audioTask = (async () => {
    if (still) {
      hasAudio = false;
      audioStatus = audioStatusFor({ still: true });
      return;
    }
    if (file.size > MAX_DECODE_BYTES) {
      // Too big to decode: keep assuming it has sound, as before.
      audioStatus = audioStatusFor({ skipped: true });
      return;
    }
    const decoded = await decodeAudio(file).catch(() => null);
    if (!decoded) {
      // decodeAudio returns nothing both for a silent file and for one it cannot read;
      // the container's track list says which, so a broken track is not called silence.
      const track = await findAudioTrack(file);
      audioStatus = audioStatusFor({ decoded: false, containerHasAudio: track.kind === "unknown" ? null : track.kind === "track" });
      hasAudio = false;
      if (track.kind === "track") audioError = `The browser could not read this file's audio${track.codec ? ` (${track.codec})` : ""}.`;
      return;
    }
    audioStatus = audioStatusFor({ decoded: true });
    const peaks = peaksFromSamples(decoded.samples, decoded.sampleRate, 50);
    await putPeaks({ assetId, peaks: peaks.peaks, perSecond: peaks.perSecond, duration: peaks.duration });
    emitAssetReady("peaks", assetId);
  })();
  const thumbTask = generateFilmstrip(
    assetId,
    file,
    info.duration,
    undefined,
    undefined,
    (done, total) => onStatus?.(`Making thumbnails, ${done} of ${total}`),
    (hidden) => onStatus?.(hidden ? "Paused while this tab is in the background. Come back to this tab and it carries on" : "Making thumbnails"),
    still,
  )
    .then(async (rec) => {
      await putThumbs(rec);
      emitAssetReady("thumbs", assetId);
    })
    .catch(() => {
      // The strip is only a preview: the import carries on, and the clip says it has none.
      previewUnavailable = true;
    });
  await Promise.all([audioTask, thumbTask]);

  const clip = createClip({
    assetId,
    name: file.name.replace(/\.[^.]+$/, ""),
    duration: info.duration,
    width: info.width,
    height: info.height,
    hasAudio,
    audioStatus,
    audioError,
    previewUnavailable,
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
