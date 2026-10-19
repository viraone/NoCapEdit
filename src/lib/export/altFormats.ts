/**
 * Two exports besides the MP4, both made with the same engine:
 *
 *  - GIF: the finished video (captions, text, transitions, as exported) is
 *    rendered small and at a low frame rate, then turned into a GIF with a
 *    palette made from the clip itself, which is what makes a GIF look right.
 *  - Transparent video: only the layer that sits on top of the picture (captions,
 *    text, stickers, animations) on a clear background, for dropping over footage
 *    in an editor. WebM (VP8 with alpha: browsers, OBS) or
 *    MOV (ProRes 4444: Final Cut Pro, Premiere Pro, DaVinci Resolve).
 */
import type { VideoProject } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { projectDuration } from "@/lib/models/timeline";
import { drawOverlayLayer, type Frame } from "@/lib/captions/renderer";
import { ensureFontsLoaded } from "@/lib/captions/fonts";
import { preloadLotties } from "@/lib/lottie/registry";
import { ffmpegEngine, FFmpegHungError, yieldToUI } from "@/lib/ffmpegEngine";
import { exportProject, outputFrame, type AssetProvider, type ExportProgress, type ExportResolution } from "@/lib/ffmpeg/exporter";
import { safeFilename } from "@/lib/utils/download";

export const GIF_MAX_SECONDS = 30;
export const TRANSPARENT_MAX_SECONDS = 120;

export interface AltResult {
  blob: Blob;
  fileName: string;
  bytes: number;
  seconds: number;
  frame: Frame;
}

const abortError = () => new DOMException("Export cancelled", "AbortError");

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

export interface GifOptions {
  /** Short side of the picture in pixels (the GIF is never made larger than the project's own format). */
  size: 320 | 480 | 640;
  /** Frames per second: 10 to 20 keeps the file small. */
  fps: 10 | 12 | 15 | 20;
  includeCaptions: boolean;
  includeOverlays: boolean;
}

export const DEFAULT_GIF_OPTIONS: GifOptions = { size: 480, fps: 15, includeCaptions: true, includeOverlays: true };

/** The ffmpeg arguments that turn the small MP4 into a GIF with its own palette. */
export function gifArgs(input: string, output: string, fps: number): string[] {
  return [
    "-hide_banner",
    "-y",
    "-i",
    input,
    "-filter_complex",
    `[0:v]fps=${fps},split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    "-loop",
    "0",
    output,
  ];
}

/** Why a GIF of this project is a bad idea, or null. */
export function gifProblem(project: VideoProject): string | null {
  const seconds = projectDuration(project.clips);
  if (!project.clips.length) return "Add a clip first.";
  if (seconds > GIF_MAX_SECONDS) return `A GIF this long would be enormous. Keep it to ${GIF_MAX_SECONDS} seconds or less (this is ${Math.round(seconds)}).`;
  return null;
}

function gifResolution(project: VideoProject, size: number): ExportResolution {
  const f = getFormat(project.formatId);
  return Math.min(f.width, f.height) <= size ? "native" : (String(size) as ExportResolution);
}

export async function exportGif(
  project: VideoProject,
  assets: AssetProvider,
  options: Partial<GifOptions>,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<AltResult> {
  const opts = { ...DEFAULT_GIF_OPTIONS, ...options };
  const problem = gifProblem(project);
  if (problem) throw new Error(problem);
  const started = performance.now();
  const resolution = gifResolution(project, opts.size);
  const frame = outputFrame(project, resolution);

  // Step 1: the picture at GIF size, as an MP4 held in memory (the first 85 % of the work).
  const rendered = await exportProject(
    project,
    assets,
    {
      resolution,
      fps: opts.fps,
      codec: "h264",
      preset: "ultrafast",
      rateControl: { mode: "crf", crf: 17 },
      includeCaptions: opts.includeCaptions,
      includeOverlays: opts.includeOverlays,
      sidecars: false,
      segmentSeconds: 0,
    },
    (p) => onProgress({ ...p, progress: p.progress * 0.85, message: p.message }),
    signal,
  );
  if (!rendered.video) throw new Error("The GIF's picture could not be rendered.");
  if (signal?.aborted) throw abortError();

  // Step 2: the palette and the GIF.
  onProgress({ stage: "encoding", progress: 0.85, message: "Making the GIF" });
  const total = projectDuration(project.clips);
  const encode = async (): Promise<Blob> => {
    await ffmpegEngine.load();
    const mounted = await ffmpegEngine.mountInputs([{ name: "gif_src.mp4", blob: rendered.video! }]);
    const out = "out.gif";
    try {
      const code = await ffmpegEngine.exec(gifArgs(mounted.inputPath("gif_src.mp4"), out, opts.fps), (t) =>
        onProgress({ stage: "encoding", progress: 0.85 + Math.min(0.14, (t / Math.max(0.1, total)) * 0.14), message: `Making the GIF ${Math.min(99, Math.round((t / Math.max(0.1, total)) * 100))}%` }),
      );
      if (signal?.aborted) throw abortError();
      if (code !== 0) throw new Error(`The GIF could not be made (ffmpeg exited with code ${code}).\n${ffmpegEngine.recentLogs()}`);
      return new Blob([(await ffmpegEngine.instance.readFile(out)) as BlobPart], { type: "image/gif" });
    } finally {
      await mounted.release().catch(() => undefined);
      if (ffmpegEngine.loadedInfo) await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
    }
  };
  const onAbort = () => ffmpegEngine.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const blob = await retryWhenThreadedEngineStalls(encode, onProgress, signal);
    onProgress({ stage: "done", progress: 1, message: "Done" });
    return { blob, fileName: `${safeFilename(project.name)}.gif`, bytes: blob.size, seconds: (performance.now() - started) / 1000, frame };
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Runs `job`; if the multi-threaded engine stalls or crashes, runs it once more on the single-threaded one (the same recovery the MP4 export has). */
async function retryWhenThreadedEngineStalls<T>(job: () => Promise<T>, onProgress: (p: ExportProgress) => void, signal?: AbortSignal): Promise<T> {
  try {
    return await job();
  } catch (e) {
    if (!(e instanceof FFmpegHungError) || !e.multithreaded || signal?.aborted) throw e;
    ffmpegEngine.preferSingleThread = true;
    ffmpegEngine.cancel();
    const notice = "Multi-threaded engine stalled; restarting single-threaded";
    onProgress({ stage: "loading", progress: 0, message: notice, notice });
    await yieldToUI();
    return job();
  }
}

// ---------------------------------------------------------------------------
// Transparent video
// ---------------------------------------------------------------------------

export type TransparentFormat = "webm" | "mov";

export interface TransparentOptions {
  format: TransparentFormat;
  fps: number;
  resolution: ExportResolution;
  includeCaptions: boolean;
  includeOverlays: boolean;
}

export const DEFAULT_TRANSPARENT_OPTIONS: TransparentOptions = { format: "webm", fps: 30, resolution: "native", includeCaptions: true, includeOverlays: true };

/**
 * The ffmpeg arguments that encode numbered PNG frames (with alpha) into the chosen format. WebM is VP8, not
 * VP9: the VP9 encoder in the wasm core crashes ("memory access out of bounds") on any picture this size, while
 * VP8 keeps the alpha plane and plays everywhere a transparent WebM does. It gets one encoder thread because
 * the engine's own thread budget is for x264.
 */
export function transparentArgs(pattern: string, output: string, o: Pick<TransparentOptions, "format" | "fps">): string[] {
  const head = ["-hide_banner", "-y", "-framerate", String(o.fps), "-i", pattern];
  if (o.format === "mov") return [...head, "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", "-r", String(o.fps), output];
  return [...head, "-c:v", "libvpx", "-pix_fmt", "yuva420p", "-crf", "10", "-b:v", "4M", "-auto-alt-ref", "0", "-deadline", "good", "-cpu-used", "4", "-threads", "1", "-r", String(o.fps), output];
}

/** Why a transparent video of this project would be empty or too long, or null. */
export function transparentProblem(project: VideoProject, o: Pick<TransparentOptions, "includeCaptions" | "includeOverlays">): string | null {
  if (!project.clips.length) return "Add a clip first.";
  const seconds = projectDuration(project.clips);
  if (seconds > TRANSPARENT_MAX_SECONDS) return `Transparent video is limited to ${TRANSPARENT_MAX_SECONDS} seconds (this is ${Math.round(seconds)}).`;
  const captions = o.includeCaptions && project.captions.visible && project.cues.length > 0;
  const overlays = o.includeOverlays && project.overlays.length > 0;
  if (!captions && !overlays) return "There is nothing to put on a clear background yet: add captions, text or stickers first.";
  return null;
}

function makeCanvas(w: number, h: number): { canvas: OffscreenCanvas | HTMLCanvasElement; ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D } {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext("2d")! };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

async function toPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

async function runTransparent(
  project: VideoProject,
  images: (assetId: string) => CanvasImageSource | undefined,
  options: Partial<TransparentOptions>,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<AltResult> {
  const opts = { ...DEFAULT_TRANSPARENT_OPTIONS, ...options };
  const problem = transparentProblem(project, opts);
  if (problem) throw new Error(problem);
  const started = performance.now();
  const frame = outputFrame(project, opts.resolution);
  const duration = projectDuration(project.clips);
  const total = Math.max(1, Math.round(duration * opts.fps));
  const renderProject: VideoProject = project;

  onProgress({ stage: "loading", progress: 0, message: "Loading video engine" });
  await ffmpegEngine.load((message) => onProgress({ stage: "loading", progress: 0, message }));
  await ensureFontsLoaded();
  await preloadLotties(project.overlays.filter((o) => o.kind === "lottie").map((o) => (o as { assetId: string }).assetId));
  if (signal?.aborted) throw abortError();

  const onAbort = () => ffmpegEngine.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  const ff = ffmpegEngine.instance;
  const dir = "/tr";
  const written: string[] = [];
  const out = `transparent.${opts.format}`;
  try {
    await ff.createDir(dir).catch(() => undefined);
    const { canvas, ctx } = makeCanvas(frame.width, frame.height);
    for (let i = 0; i < total; i++) {
      if (signal?.aborted) throw abortError();
      const t = i / opts.fps;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, frame.width, frame.height);
      // Stickers placed behind the subject are still graphics here, so they go first.
      if (opts.includeOverlays) drawOverlayLayer(ctx, renderProject, t, frame, { images, includeOverlays: true, includeCaptions: false, layer: "behind" });
      drawOverlayLayer(ctx, renderProject, t, frame, { images, includeCaptions: opts.includeCaptions, includeOverlays: opts.includeOverlays });
      const path = `${dir}/f${String(i).padStart(5, "0")}.png`;
      await ff.writeFile(path, await toPng(canvas));
      written.push(path);
      if (i % 4 === 0 || i === total - 1) onProgress({ stage: "frames", progress: ((i + 1) / total) * 0.4, message: `Drawing frames ${i + 1}/${total}` });
    }
    onProgress({ stage: "encoding", progress: 0.4, message: opts.format === "mov" ? "Encoding ProRes 4444" : "Encoding WebM with transparency" });
    const code = await ffmpegEngine.exec(transparentArgs(`${dir}/f%05d.png`, out, opts), (t) =>
      onProgress({ stage: "encoding", progress: 0.4 + Math.min(0.59, (t / Math.max(0.1, duration)) * 0.59), message: `Encoding ${Math.min(99, Math.round((t / Math.max(0.1, duration)) * 100))}%` }),
    );
    if (signal?.aborted) throw abortError();
    if (code !== 0) throw new Error(`The transparent video could not be made (ffmpeg exited with code ${code}).\n${ffmpegEngine.recentLogs()}`);
    const data = (await ff.readFile(out)) as Uint8Array;
    const blob = new Blob([data as BlobPart], { type: opts.format === "mov" ? "video/quicktime" : "video/webm" });
    onProgress({ stage: "done", progress: 1, message: "Done" });
    return { blob, fileName: `${safeFilename(project.name)}.${opts.format}`, bytes: blob.size, seconds: (performance.now() - started) / 1000, frame };
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (ffmpegEngine.loadedInfo) {
      for (const p of written) await ffmpegEngine.instance.deleteFile(p).catch(() => undefined);
      await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
      await ffmpegEngine.instance.deleteDir(dir).catch(() => undefined);
    }
  }
}

export function exportTransparent(
  project: VideoProject,
  images: (assetId: string) => CanvasImageSource | undefined,
  options: Partial<TransparentOptions>,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<AltResult> {
  return retryWhenThreadedEngineStalls(() => runTransparent(project, images, options, onProgress, signal), onProgress, signal);
}
