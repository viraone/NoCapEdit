/**
 * Fast export: read the file, decode it with WebCodecs, composite, encode.
 *
 * The first mobile exporter (exportLite.ts) plays the clip through a
 * <video> at 1× and captures each presented frame, so a five-minute clip
 * takes five minutes. Here Mediabunny demuxes the file and drives the
 * hardware decoder directly, which runs many times faster than real time;
 * each decoded frame is drawn through the reframe crop onto a canvas, the
 * captions for its timestamp are burned in, and the canvas goes to the
 * encoder. The audio track is copied across untouched when the container
 * allows it (AAC from an iPhone does), so nothing is re-encoded there.
 *
 * It needs a browser that can decode the clip's codec through WebCodecs.
 * Anything it can't handle throws FastExportUnsupported so the caller can
 * fall back to the real-time exporter.
 */
import type { CaptionCue, SubtitleStyle } from "@/lib/models/project";
import type { Ctx } from "@/lib/captions/renderer";
import { CaptionLayer } from "@/lib/mobile/captionLayer";
import { GlCompositor } from "@/lib/mobile/glCompositor";
import { GpuCompositor } from "@/lib/mobile/gpuCompositor";
import { BlobFileSink } from "@/lib/mobile/blobFileSink";
import { cropRect, DEFAULT_REFRAME, outputFrame, placeWholeFrame, type Reframe } from "@/lib/mobile/reframe";
import type { ExportStats, LiteExportResult, LiteProgress } from "@/lib/mobile/exportLite";

/** The on-screen canvas shows every Nth frame, scaled down. */
const PREVIEW_EVERY = 15;
const PREVIEW_MAX_EDGE = 480;

export class FastExportUnsupported extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "FastExportUnsupported";
  }
}

export interface FastExportOptions {
  file: Blob;
  cues: CaptionCue[];
  style: SubtitleStyle;
  /** Frames are composited here; it is on screen, so the render is visible. */
  canvas: HTMLCanvasElement;
  reframe?: Reframe;
  maxEdge?: number;
  /** Long clips: stream the MP4 into Blob storage instead of memory. */
  streaming?: boolean;
  onProgress?: (p: LiteProgress) => void;
  signal?: AbortSignal;
  /** Profiling only. `passthrough`: hand decoded frames straight to the
   * encoder (no compositing at all) — the decode + encode floor.
   * `nocaptions`: composite through the GPU but skip captions.
   * `resize-only`: let the library resize. `gl` / `2d`: force the WebGL
   * or 2D-canvas compositor instead of WebGPU. */
  debugMode?: "passthrough" | "nocaptions" | "resize-only" | "gl" | "2d";
}

export type FastExportDebugMode = NonNullable<FastExportOptions["debugMode"]>;

export async function fastExportCaptionedVideo(opts: FastExportOptions): Promise<LiteExportResult> {
  const { file, cues, style, canvas, signal } = opts;
  const progress = (p: LiteProgress) => opts.onProgress?.(p);
  if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined") {
    throw new FastExportUnsupported("WebCodecs is not available in this browser");
  }

  progress({ phase: "prepare", progress: null, message: "Preparing" });
  const mb = await import("mediabunny");
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    if (!(await input.canRead().catch(() => false))) throw new FastExportUnsupported("unrecognised file format");
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new FastExportUnsupported("no video track");
    if (!(await track.canDecode())) {
      throw new FastExportUnsupported(`this browser can't decode ${track.codec ?? "this video"} directly`);
    }

    // Display size = after rotation metadata (a portrait iPhone clip is
    // stored landscape with a 90° flag).
    const sourceWidth = track.displayWidth;
    const sourceHeight = track.displayHeight;
    const reframe = opts.reframe ?? DEFAULT_REFRAME;
    const out = outputFrame(sourceWidth, sourceHeight, reframe, opts.maxEdge ?? 1920);
    const crop = cropRect(sourceWidth, sourceHeight, reframe);
    const place = placeWholeFrame(sourceWidth, sourceHeight, crop, out.width, out.height);
    // Composite off screen. A canvas that is being presented costs the
    // page compositor on every frame; the on-screen one only gets a small
    // preview every few frames so the render is still visible.
    // Compositor, best first: WebGPU imports the decoded frame with no
    // copy (the path that is fast on iPhone), WebGL takes it as a texture,
    // and a 2D canvas is the fallback everywhere else.
    let gpu: GpuCompositor | null = null;
    let gl: GlCompositor | null = null;
    if (opts.debugMode !== "2d" && opts.debugMode !== "gl") gpu = await GpuCompositor.create(out.width, out.height);
    if (!gpu && opts.debugMode !== "2d" && GlCompositor.supported()) {
      try {
        gl = new GlCompositor(out.width, out.height);
      } catch (e) {
        console.warn("[nocap mobile] WebGL compositor unavailable, using 2D canvas", e);
        gl = null;
      }
    }
    let work: OffscreenCanvas | HTMLCanvasElement =
      gpu?.canvas ?? gl?.canvas ?? (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(out.width, out.height) : canvas);
    let previewCtx: CanvasRenderingContext2D | null = null;
    if (work === canvas) {
      canvas.width = out.width;
      canvas.height = out.height;
    } else {
      const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(out.width, out.height));
      canvas.width = Math.max(2, Math.round(out.width * scale));
      canvas.height = Math.max(2, Math.round(out.height * scale));
      previewCtx = canvas.getContext("2d");
    }
    const ctx = gpu || gl ? null : (work.getContext("2d", { alpha: false }) as Ctx | null);
    if (!gpu && !gl && !ctx) throw new Error("Canvas is not available.");

    // 60 fps phone footage is halved; anything at or under 30 keeps its own timing.
    const stats = await track.computePacketStats(120).catch(() => null);
    const sourceFps = stats?.averagePacketRate ?? 30;
    const frameRate = sourceFps > 32 ? 30 : undefined;
    const bitrate = Math.min(12_000_000, Math.max(2_500_000, Math.round(out.width * out.height * 30 * 0.1)));
    const duration = await input.computeDuration().catch(() => 0);

    const sink = opts.streaming ? new BlobFileSink() : null;
    const bufferTarget = sink ? null : new mb.BufferTarget();
    const target =
      bufferTarget ??
      new mb.StreamTarget(
        new WritableStream({
          write(chunk) {
            sink!.write(chunk.data, chunk.position);
          },
        }),
        { chunked: true, chunkSize: 4 * 1024 * 1024 },
      );
    const output = new mb.Output({
      format: new mb.Mp4OutputFormat({ fastStart: sink ? false : "in-memory" }),
      target,
    });

    const frame = { width: out.width, height: out.height };
    const captions = new CaptionLayer(cues, style, frame);
    const hdr = await track.hasHighDynamicRange().catch(() => false);
    // Profiling for the on-screen timer: time inside the callback, split
    // into video and captions, and the time between callbacks (decode,
    // encode, muxing, waiting).
    const spent = { video: 0, captions: 0, other: 0 };
    let frames = 0;
    let lastEnd = 0;
    let gpuVerified = false;
    const conversion = await mb.Conversion.init({
      input,
      output,
      showWarnings: false,
      video: {
        forceTranscode: true,
        codec: "avc",
        bitrate,
        keyFrameInterval: 2,
        ...(frameRate ? { frameRate } : {}),
        // Bake rotation into the pixels before `process`, so the crop
        // rectangle is in the same upright coordinates the preview used.
        allowTransformationMetadata: false,
        ...(opts.debugMode === "resize-only"
          ? { width: out.width, height: out.height, fit: "cover" as const }
          : opts.debugMode === "passthrough"
            ? { processedWidth: sourceWidth, processedHeight: sourceHeight }
            : { processedWidth: out.width, processedHeight: out.height }),
        process: opts.debugMode === "resize-only" ? undefined : (sample) => {
          const t0 = performance.now();
          if (lastEnd) spent.other += t0 - lastEnd;
          if (opts.debugMode === "passthrough") {
            frames += 1;
            lastEnd = performance.now();
            return sample;
          }
          const noCaptions = opts.debugMode === "nocaptions";
          let t1: number;
          if (gpu) {
            const layers = noCaptions ? { static: null, active: null, band: { top: 0, height: out.height } } : captions.update(sample.timestamp);
            t1 = performance.now();
            const uv = GpuCompositor.uvFor(crop, sample.displayWidth, sample.displayHeight, sample.rotation, sample.flip);
            const composite = () => {
              const vf = sample.toVideoFrame();
              try {
                gpu!.draw(vf, uv, layers);
              } finally {
                vf.close();
              }
              // Read the canvas back ourselves so the cost lands in "draw".
              return new VideoFrame(gpu!.canvas, { timestamp: sample.microsecondTimestamp, duration: sample.microsecondDuration });
            };
            const finish = (outFrame: VideoFrame) => {
              spent.video += performance.now() - t1;
              spent.captions += t1 - t0;
              frames += 1;
              if (previewCtx && frames % PREVIEW_EVERY === 0) previewCtx.drawImage(gpu!.canvas, 0, 0, canvas.width, canvas.height);
              lastEnd = performance.now();
              return outFrame;
            };
            if (gpuVerified) return finish(composite());
            // First real frame: a decoder-backed VideoFrame is the one thing
            // the self-test couldn't try. Draw it under an error scope; if
            // WebGPU rejects it, switch to WebGL and redo this frame there.
            gpu.beginCheck();
            const first = composite();
            return gpu.endCheck().then((err) => {
              if (!err) {
                gpuVerified = true;
                return finish(first);
              }
              first.close();
              console.warn("[nocap mobile] WebGPU rejected a decoded frame, switching to WebGL:", err.message);
              gpu!.dispose();
              gpu = null;
              gl = GlCompositor.supported() ? new GlCompositor(out.width, out.height) : null;
              if (!gl) throw new Error("No compositor could render this video.");
              work = gl.canvas;
              const vf = sample.toVideoFrame();
              try {
                gl.draw(vf, uv, layers);
              } finally {
                vf.close();
              }
              spent.video += performance.now() - t1;
              spent.captions += t1 - t0;
              frames += 1;
              lastEnd = performance.now();
              return gl.canvas;
            });
          }
          if (gl) {
            const layers = noCaptions ? { static: null, active: null, band: { top: 0, height: out.height } } : captions.update(sample.timestamp);
            t1 = performance.now();
            const vf = sample.toVideoFrame();
            try {
              const uv = GlCompositor.uvFor(crop, sample.displayWidth, sample.displayHeight, sample.rotation, sample.flip);
              gl.draw(vf, uv, layers);
            } finally {
              vf.close();
            }
          } else {
            sample.draw(ctx!, place.dx, place.dy, place.dw, place.dh);
            t1 = performance.now();
            if (!noCaptions) captions.draw(ctx!, sample.timestamp);
          }
          const t2 = performance.now();
          spent.video += t1 - t0;
          spent.captions += t2 - t1;
          frames += 1;
          if (previewCtx && frames % PREVIEW_EVERY === 0) previewCtx.drawImage(work, 0, 0, canvas.width, canvas.height);
          lastEnd = performance.now();
          return work;
        },
      },
    });

    if (!conversion.isValid || !conversion.utilizedTracks.some((t) => t.isVideoTrack())) {
      const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(", ") || "conversion not possible";
      throw new FastExportUnsupported(why);
    }

    conversion.onProgress = (p) => progress({ phase: "video", progress: Math.min(1, Math.max(0, p)), message: "Rendering" });
    const onAbort = () => {
      void conversion.cancel();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await conversion.execute();
    } catch (e) {
      if (signal?.aborted || e instanceof mb.ConversionCanceledError) throw new DOMException("Export cancelled", "AbortError");
      throw e;
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");

    progress({ phase: "mux", progress: null, message: "Finishing" });
    const blob = sink ? sink.finalize() : new Blob([bufferTarget!.buffer as ArrayBuffer], { type: "video/mp4" });
    const hasAudio = conversion.utilizedTracks.some((t) => t.isAudioTrack());
    const n = Math.max(1, frames);
    gpu?.dispose();
    gl?.dispose();
    const exportStats: ExportStats = {
      source: `${sourceWidth}×${sourceHeight} ${track.codec ?? "?"} ${Math.round(sourceFps)} fps${hdr ? " HDR" : ""} · ${gpu ? "gpu" : gl ? "gl" : "2d"}${opts.debugMode ? ` · ${opts.debugMode}` : ""}`,
      frames,
      msVideo: spent.video / n,
      msCaptions: spent.captions / n,
      msOther: spent.other / n,
      captionRenders: captions.renders,
    };
    return { blob, width: out.width, height: out.height, audio: hasAudio ? "aac" : "none", seconds: duration, engine: "fast", stats: exportStats };
  } finally {
    input.dispose();
  }
}
