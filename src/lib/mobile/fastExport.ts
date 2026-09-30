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
import { drawCue } from "@/lib/captions/renderer";
import { BlobFileSink } from "@/lib/mobile/blobFileSink";
import { cropRect, DEFAULT_REFRAME, outputFrame, placeWholeFrame, type Reframe } from "@/lib/mobile/reframe";
import type { LiteExportResult, LiteProgress } from "@/lib/mobile/exportLite";

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
}

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
    canvas.width = out.width;
    canvas.height = out.height;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas is not available.");

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
        processedWidth: out.width,
        processedHeight: out.height,
        process: (sample) => {
          const t = sample.timestamp;
          sample.draw(ctx, place.dx, place.dy, place.dw, place.dh);
          for (const cue of cues) {
            if (t >= cue.start && t < cue.end) drawCue(ctx, cue, style, frame, t, { showTranslated: false });
          }
          return canvas;
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
    return { blob, width: out.width, height: out.height, audio: hasAudio ? "aac" : "none", seconds: duration, engine: "fast" };
  } finally {
    input.dispose();
  }
}
