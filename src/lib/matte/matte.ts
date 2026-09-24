/**
 * Subject cut-out (video matting) with RMBG via the ML worker: an offline pass
 * samples the clip at a few frames per second, stores compressed alpha masks
 * as one asset, and the compositor applies the nearest mask to every frame.
 */
import { zlibSync, unzlibSync } from "fflate";
import type { Clip, ClipMatte } from "@/lib/models/project";
import { getAsset, putAsset } from "@/lib/storage/db";
import { mlRequest, type MlProgress } from "@/lib/speech/mlClient";
import { uid } from "@/lib/utils/id";

export interface MatteFrames {
  width: number;
  height: number;
  fps: number;
  count: number;
  /** count × width × height alpha bytes. */
  masks: Uint8Array;
}

export function encodeMatte(m: MatteFrames): Blob {
  const header = new TextEncoder().encode(JSON.stringify({ width: m.width, height: m.height, fps: m.fps, count: m.count }));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, header.length);
  return new Blob([len, header, zlibSync(m.masks, { level: 6 })], { type: "application/octet-stream" });
}

export async function decodeMatte(blob: Blob): Promise<MatteFrames> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const hlen = new DataView(buf.buffer).getUint32(0);
  const header = JSON.parse(new TextDecoder().decode(buf.subarray(4, 4 + hlen)));
  const masks = unzlibSync(buf.subarray(4 + hlen));
  return { ...header, masks };
}

const cache = new Map<string, MatteFrames | null>();
const loading = new Set<string>();

export function getMatteSync(assetId: string): MatteFrames | null {
  if (cache.has(assetId)) return cache.get(assetId) ?? null;
  if (!loading.has(assetId)) {
    loading.add(assetId);
    getAsset(assetId)
      .then(async (a) => cache.set(assetId, a ? await decodeMatte(a.blob) : null))
      .catch(() => cache.set(assetId, null))
      .finally(() => loading.delete(assetId));
  }
  return null;
}

export async function getMatte(assetId: string): Promise<MatteFrames | null> {
  if (cache.has(assetId)) return cache.get(assetId) ?? null;
  const a = await getAsset(assetId);
  const m = a ? await decodeMatte(a.blob) : null;
  cache.set(assetId, m);
  return m;
}

/** Alpha mask (0..255, width×height) for one image via the worker. */
export function maskForImage(blob: Blob, onProgress?: (p: MlProgress) => void, signal?: AbortSignal): Promise<{ alpha: Uint8Array; width: number; height: number }> {
  return mlRequest((id) => ({ type: "matte", id, image: blob }), onProgress, signal);
}

/** Removes the background of a still image; returns a PNG with alpha. */
export async function removeImageBackground(blob: Blob, onProgress?: (p: MlProgress) => void, signal?: AbortSignal): Promise<Blob> {
  const { alpha, width, height } = await maskForImage(blob, onProgress, signal);
  const bmp = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, width, height);
  const img = ctx.getImageData(0, 0, width, height);
  for (let i = 0, j = 3; i < alpha.length; i++, j += 4) img.data[j] = alpha[i];
  ctx.putImageData(img, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
}

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener("seeked", finish);
      resolve();
    };
    video.addEventListener("seeked", finish);
    setTimeout(finish, 1500);
    video.currentTime = time;
  });
}

export interface MattingOptions {
  videoUrl: string;
  clip: Clip;
  projectId: string;
  fps?: number;
  /** Mask resolution (longest side). */
  size?: number;
  onProgress?: (message: string, progress: number | null) => void;
  signal?: AbortSignal;
}

/** Runs the offline matting pass over the clip's trimmed range and stores the masks as an asset. */
export async function matteClip(o: MattingOptions): Promise<ClipMatte> {
  const fps = o.fps ?? 8;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not load the clip"));
    video.src = o.videoUrl;
  });
  const long = o.size ?? 512;
  const scale = Math.min(1, long / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.max(2, Math.round(video.videoWidth * scale));
  const height = Math.max(2, Math.round(video.videoHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const { inPoint, outPoint } = o.clip;
  const count = Math.max(1, Math.ceil((outPoint - inPoint) * fps));
  const masks = new Uint8Array(count * width * height);
  try {
    for (let i = 0; i < count; i++) {
      if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      await seek(video, Math.min(outPoint, inPoint + i / fps));
      ctx.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.9));
      const { alpha, width: mw, height: mh } = await maskForImage(blob, (p) => (i === 0 ? o.onProgress?.(p.message, p.progress) : undefined), o.signal);
      if (mw === width && mh === height) masks.set(alpha, i * width * height);
      else {
        // Resample if the model returned another size.
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) masks[i * width * height + y * width + x] = alpha[Math.floor((y / height) * mh) * mw + Math.floor((x / width) * mw)];
      }
      o.onProgress?.(`Cutting out frame ${i + 1} / ${count}`, (i + 1) / count);
    }
  } finally {
    video.removeAttribute("src");
    video.load();
  }
  const blob = encodeMatte({ width, height, fps, count, masks });
  const assetId = uid("asset");
  await putAsset({ id: assetId, projectId: o.projectId, name: `matte:${o.clip.name}`, type: "application/octet-stream", size: blob.size, blob, createdAt: Date.now() });
  cache.set(assetId, { width, height, fps, count, masks });
  return { assetId, width, height, fps, count, inPoint, outPoint };
}
