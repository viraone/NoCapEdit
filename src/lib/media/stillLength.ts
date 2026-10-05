/**
 * Picture clips (a flyer or photo added as a clip) are real silent videos, so a
 * longer show time means rendering a longer video. This takes the first frame of
 * the clip's media and loops it into a new MP4 of the asked-for length; the
 * caller swaps the clip over to it.
 */
import { ffmpegEngine } from "@/lib/ffmpegEngine";
import { withDeadline } from "@/lib/ffmpeg/deadline";
import { imageToStillVideo, STILL_FPS } from "@/lib/media/stillVideo";
import { getThumbs } from "@/lib/storage/db";

/** Longest a picture may be shown (half an hour). */
export const MAX_STILL_SECONDS = 1800;

/** Past this length a still is rendered at a low frame rate: a picture does not move, and 30 fps would only cost render time. */
const LONG_STILL_SECONDS = 30;
const LONG_STILL_FPS = 5;

const WORKER_CALL_MS = 20_000;
/** Mean difference (0..255) between filmstrip frames below which a clip counts as a held picture. */
const STILL_FRAME_DIFF = 8;
/** A pixel (of the 32x32 comparison) changed strongly above this per-channel difference, and no more than this share of them may (a held picture measures about 0.1%, a small object moving about 4%, real motion more). */
const STRONG_CHANGE = 64;
const STILL_STRONG_SHARE = 0.02;

/** Frame rate used for a still of this length. */
export function stillFps(seconds: number): number {
  return seconds > LONG_STILL_SECONDS ? LONG_STILL_FPS : STILL_FPS;
}

/** The first frame of a video as PNG bytes. */
async function firstFramePng(blob: Blob, onStatus?: (message: string) => void): Promise<Uint8Array> {
  await ffmpegEngine.load((m) => onStatus?.(m));
  const mounted = await withDeadline(ffmpegEngine.mountInputs([{ name: "still_src.bin", blob }]), WORKER_CALL_MS, () => ffmpegEngine.stalled("opening the picture"));
  const out = `/frame_${Date.now().toString(36)}.png`;
  try {
    const code = await ffmpegEngine.exec(["-hide_banner", "-y", "-i", mounted.inputPath("still_src.bin"), "-frames:v", "1", out]);
    if (code !== 0) throw new Error(`Could not read the picture.\n${ffmpegEngine.recentLogs()}`);
    return (await withDeadline(ffmpegEngine.instance.readFile(out), WORKER_CALL_MS, () => ffmpegEngine.stalled("reading the picture"))) as Uint8Array;
  } finally {
    await withDeadline(
      (async () => {
        await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
        await mounted.release().catch(() => undefined);
      })(),
      WORKER_CALL_MS,
      () => {
        ffmpegEngine.cancel();
        return new Error("cleanup stalled");
      },
    ).catch(() => undefined);
  }
}

/** Renders the first frame of `media` as a silent video of `seconds`, named like the clip. */
export async function renderStillLength(media: Blob, name: string, seconds: number, onStatus?: (message: string) => void): Promise<File> {
  const length = Math.min(MAX_STILL_SECONDS, Math.max(1, seconds));
  const png = await firstFramePng(media, onStatus);
  const frame = new File([new Uint8Array(png)], `${name}.png`, { type: "image/png" });
  return imageToStillVideo(frame, { seconds: length, fps: stillFps(length), onStatus });
}

/**
 * Whether a clip's media is a picture held still, judged from its stored
 * filmstrip: every frame matches the first. Clips made from
 * images carry a flag, but older ones do not.
 */
export async function looksLikeStill(assetId: string): Promise<boolean> {
  const rec = await getThumbs(assetId);
  if (!rec || rec.count < 3) return false;
  const bmp = await createImageBitmap(rec.sprite);
  try {
    const W = 32;
    const H = 32;
    const grab = (i: number) => {
      const ctx = new OffscreenCanvas(W, H).getContext("2d")!;
      ctx.drawImage(bmp, i * rec.frameWidth, 0, rec.frameWidth, rec.frameHeight, 0, 0, W, H);
      return ctx.getImageData(0, 0, W, H).data;
    };
    const a = grab(0);
    /** Mean difference over the frame, and the share of pixels that changed strongly (a small object moving barely moves the mean). */
    const diff = (b: Uint8ClampedArray) => {
      let sum = 0;
      let strong = 0;
      for (let i = 0; i < a.length; i += 4) {
        const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
        sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
        if (d > STRONG_CHANGE) strong++;
      }
      return { mean: sum / (W * H * 3), strong: strong / (W * H) };
    };
    // Compression noise alone makes frames of a held picture differ by about 4; moving video differs by far more.
    for (let i = 1; i < rec.count; i++) {
      const d = diff(grab(i));
      if (d.mean >= STILL_FRAME_DIFF || d.strong > STILL_STRONG_SHARE) return false;
    }
    return true;
  } finally {
    bmp.close();
  }
}
