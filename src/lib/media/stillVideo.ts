/**
 * Turns a still image (flyer, poster, screenshot) into a short silent video
 * clip so it can sit on the timeline like any recording. The image is decoded
 * in the browser (any format the browser reads), scaled to at most 1920 px on
 * its long side with even dimensions, handed to ffmpeg.wasm as a PNG and
 * looped into an H.264 MP4 at the requested length.
 */
import { ffmpegEngine } from "@/lib/ffmpegEngine";

export const STILL_SECONDS = 8;
export const STILL_FPS = 30;
const MAX_SIDE = 1920;

export function isImageFile(file: File): boolean {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif|heic)$/i.test(file.name);
}

async function decodeToPng(file: File): Promise<{ png: Uint8Array; width: number; height: number }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.max(2, Math.round((bmp.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((bmp.height * scale) / 2) * 2);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return { png: new Uint8Array(await blob.arrayBuffer()), width, height };
}

export interface StillVideoOptions {
  seconds?: number;
  fps?: number;
  onStatus?: (message: string) => void;
}

/** Renders `file` into an MP4 File named after the image. */
export async function imageToStillVideo(file: File, opts: StillVideoOptions = {}): Promise<File> {
  const seconds = opts.seconds ?? STILL_SECONDS;
  const fps = opts.fps ?? STILL_FPS;
  opts.onStatus?.(`Preparing ${file.name}`);
  const { png } = await decodeToPng(file);
  await ffmpegEngine.load((m) => opts.onStatus?.(m));
  const ffmpeg = ffmpegEngine.instance;
  const input = `/still_${Date.now().toString(36)}.png`;
  const output = `/still_${Date.now().toString(36)}.mp4`;
  await ffmpeg.writeFile(input, png);
  try {
    opts.onStatus?.(`Rendering ${file.name} as a ${seconds} s clip`);
    const code = await ffmpegEngine.exec([
      "-hide_banner", "-y",
      // One decoder thread is plenty for a single image.
      "-threads", "1", "-loop", "1", "-framerate", String(fps), "-t", String(seconds), "-i", input,
      "-an", "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(fps),
      "-movflags", "+faststart", output,
    ]);
    if (code !== 0) throw new Error(`Could not render the image as a clip.\n${ffmpegEngine.recentLogs()}`);
    const data = (await ffmpeg.readFile(output)) as Uint8Array;
    const name = `${file.name.replace(/\.[^.]+$/, "")}.mp4`;
    return new File([new Uint8Array(data)], name, { type: "video/mp4" });
  } finally {
    await ffmpeg.deleteFile(input).catch(() => undefined);
    await ffmpeg.deleteFile(output).catch(() => undefined);
  }
}

/** Videos pass through; images become still clips. */
export async function toClipFile(file: File, onStatus?: (message: string) => void): Promise<File> {
  return isImageFile(file) ? imageToStillVideo(file, { onStatus }) : file;
}
