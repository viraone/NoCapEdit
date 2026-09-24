/**
 * Project export on top of ffmpegEngine.
 *
 *  - the timeline is split into render segments (see segments.ts) so memory
 *    stays bounded and each finished piece streams to disk immediately
 *  - "filters" segments use one ffmpeg graph: trim, speed + pitch, zoom/pan,
 *    xfade transitions, HDR tone-mapping, the caption/overlay PNG layer, music
 *    and voice-over mixing
 *  - "compositor" segments (GPU shader transitions, motion-tracked overlays,
 *    auto-reframed clips) are rendered frame-by-frame with the same canvas
 *    compositor as the preview and encoded from a JPEG frame sequence
 *  - sidecar SRT / TXT / WebVTT files are generated from the cues
 */
import { getFormat } from "@/lib/models/formats";
import type { VideoProject } from "@/lib/models/project";
import { layoutClips } from "@/lib/models/timeline";
import { computePlacement } from "@/lib/models/placement";
import { drawOverlayLayer, isActive, tokenize, wordTimingsFor, cueDisplayText, type Frame } from "@/lib/captions/renderer";
import { ensureFontsLoaded } from "@/lib/captions/fonts";
import { toSrt, toTranscript } from "@/lib/captions/srt";
import { toSpeakerSrt, toWebVtt } from "@/lib/transcriptionEngine";
import { even } from "@/lib/utils/math";
import { captureFrames, needsCompositor } from "@/lib/playback/compositor";
import { musicSourceTime } from "@/lib/playback/engine";
import {
  ffmpegEngine,
  encoderArgs,
  FFmpegHungError,
  type EncodeSettings,
  type HdrMode,
  type MediaInfo,
  type RateControl,
  type RenderInput,
  type RenderJob,
  type RenderSegmentJob,
  type SegmentContext,
  type VideoCodec,
  type X264Preset,
} from "@/lib/ffmpegEngine";
import type { FFmpegInfo } from "./loader";
import { AAC_PRIMING_SECONDS, buildFilterGraph, buildInputArgs, type ClipInputPlan, type ExportFiles, type ExportPlan, type MusicPlan, type VoiceoverPlan } from "./filters";
import { planSegments, segmentGrid } from "./segments";
import { createBlobSink, type OutputSink } from "./sinks";

export type ExportResolution = "native" | "720" | "1080" | "1440" | "2160";

export interface ExportOptions {
  resolution: ExportResolution;
  fps: number;
  codec: VideoCodec;
  preset: X264Preset;
  rateControl: RateControl;
  hdr: HdrMode;
  includeCaptions: boolean;
  captionSource: "original" | "translated";
  includeOverlays: boolean;
  sidecars: boolean;
  /** Target length of each streamed segment (0 = single pass). */
  segmentSeconds: number;
  renderMode: "auto" | "filters" | "compositor";
  /** Frame format handed to ffmpeg on the compositor path: JPEG (q 0.93, fast) or lossless PNG. */
  intermediate: "jpeg" | "png";
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  resolution: "native",
  fps: 30,
  codec: "h264",
  preset: "veryfast",
  rateControl: { mode: "crf", crf: 23 },
  hdr: "auto",
  includeCaptions: true,
  captionSource: "original",
  includeOverlays: true,
  sidecars: true,
  segmentSeconds: 20,
  renderMode: "auto",
  intermediate: "jpeg",
};

export type ExportStage = "loading" | "preparing" | "overlays" | "frames" | "encoding" | "writing" | "finalizing" | "done";

export interface ExportProgress {
  stage: ExportStage;
  progress: number;
  message: string;
  /** The ffmpeg engine actually running the export, once it is loaded. */
  engine?: FFmpegInfo;
}

export interface ExportResult {
  /** The MP4, or null when it was streamed to a file on disk. */
  video: Blob | null;
  fileName: string;
  srt: Blob | null;
  txt: Blob | null;
  vtt: Blob | null;
  info: FFmpegInfo;
  overlayFrames: number;
  capturedFrames: number;
  seconds: number;
  bytes: number;
  segments: number;
  streamed: boolean;
  frame: Frame;
}

export interface AssetProvider {
  getBlob(assetId: string): Promise<Blob | undefined>;
  getImage(assetId: string): CanvasImageSource | undefined;
  /** Object URLs for video assets (needed by the frame compositor). */
  urls: Record<string, string>;
}

const abortError = () => new DOMException("Export cancelled", "AbortError");

function extensionFor(blob: Blob, fallback: string): string {
  const map: Record<string, string> = {
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "video/webm": "webm",
    "video/x-matroska": "mkv",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/flac": "flac",
    "audio/aac": "aac",
  };
  return map[blob.type] ?? fallback;
}

/** Output size for a resolution preset, keeping the format's aspect ratio. */
export function outputFrame(project: VideoProject, resolution: ExportResolution): Frame {
  const format = getFormat(project.formatId);
  if (resolution === "native") return { width: even(format.width), height: even(format.height) };
  const target = Number(resolution);
  const shortSide = Math.min(format.width, format.height);
  const scale = target / shortSide;
  return { width: even(format.width * scale), height: even(format.height * scale) };
}

/** Times inside [from, to] at which the caption/overlay layer changes. */
export function overlayChangeTimes(project: VideoProject, from: number, to: number, opts: Pick<ExportOptions, "includeCaptions" | "includeOverlays" | "captionSource">): number[] {
  const times = new Set<number>([from]);
  const add = (t: number) => {
    if (t > from && t < to) times.add(Math.round(t * 1000) / 1000);
  };
  if (opts.includeOverlays) {
    for (const ov of project.overlays) {
      add(ov.start);
      add(ov.end);
    }
  }
  if (opts.includeCaptions && project.captions.visible) {
    const showTranslated = opts.captionSource === "translated";
    for (const cue of project.cues) {
      add(cue.start);
      add(cue.end);
      if (project.subtitleStyle.highlight) {
        const tokens = tokenize(cueDisplayText(cue, showTranslated));
        for (const w of wordTimingsFor(cue, tokens)) if (w.start > cue.start && w.start < cue.end) add(w.start);
      }
    }
  }
  return [...times].sort((a, b) => a - b);
}

function createCanvas(w: number, h: number) {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(w, h);
    return { canvas, ctx: canvas.getContext("2d")! };
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d")! };
}

async function canvasToPng(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<Uint8Array> {
  const blob =
    canvas instanceof OffscreenCanvas
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encode failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

const pad = (n: number, width = 5) => String(n).padStart(width, "0");

export async function exportProject(
  project: VideoProject,
  assets: AssetProvider,
  options: Partial<ExportOptions>,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
  sink?: OutputSink,
): Promise<ExportResult> {
  try {
    return await runExport(project, assets, options, onProgress, signal, sink);
  } catch (e) {
    // Hangs inside a segment resume on a fresh engine in ffmpegEngine.render();
    // this catches a hang before the first segment (probing) on the threaded
    // core, where nothing has been written yet and a clean restart is cheapest.
    if (!(e instanceof FFmpegHungError) || !e.multithreaded || signal?.aborted) throw e;
    ffmpegEngine.preferSingleThread = true;
    ffmpegEngine.cancel();
    await sink?.reset();
    onProgress({ stage: "loading", progress: 0, message: "Multi-threaded engine stalled; restarting single-threaded" });
    return runExport(project, assets, options, onProgress, signal, sink);
  }
}

/** The segments an export will render, using the same plan as the exporter (for the panel summary). */
export function plannedSegments(project: VideoProject, opts: Pick<ExportOptions, "segmentSeconds" | "fps">) {
  return planSegments(project.clips, opts.segmentSeconds, { grid: segmentGrid(opts.fps) });
}

async function runExport(
  project: VideoProject,
  assets: AssetProvider,
  options: Partial<ExportOptions>,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal,
  sink?: OutputSink,
): Promise<ExportResult> {
  const opts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  if (!project.clips.length) throw new Error("Add at least one clip before exporting.");
  const layouts = layoutClips(project.clips);
  const duration = layouts[layouts.length - 1].end;
  if (duration <= 0) throw new Error("The project has no duration.");
  const check = () => {
    if (signal?.aborted) throw abortError();
  };

  const frame = outputFrame(project, opts.resolution);
  const settings: EncodeSettings = {
    width: frame.width,
    height: frame.height,
    fps: opts.fps,
    codec: opts.codec,
    preset: opts.preset,
    rateControl: opts.rateControl,
    audioBitrateKbps: 160,
    gopSeconds: 2,
    hdr: opts.hdr,
  };
  const fileName = `${project.name.replace(/[^\w\-. ]+/g, "_").trim() || "nocapedit"}.mp4`;
  const out = sink ?? createBlobSink(fileName);

  // ---- inputs ---------------------------------------------------------------
  const inputs: RenderInput[] = [];
  const nameOf = new Map<string, string>();
  const addInput = async (assetId: string, prefix: string, fallbackExt: string) => {
    if (nameOf.has(assetId)) return;
    const blob = await assets.getBlob(assetId);
    if (!blob) throw new Error("A media file used by this project is missing from local storage.");
    const name = `${prefix}${inputs.length}.${extensionFor(blob, fallbackExt)}`;
    inputs.push({ name, blob });
    nameOf.set(assetId, name);
  };
  onProgress({ stage: "preparing", progress: 0, message: "Collecting media" });
  for (const clip of project.clips) {
    await addInput(clip.assetId, "clip", "mp4");
    if (clip.audioAssetId) await addInput(clip.audioAssetId, "aud", "wav");
  }
  if (project.music) await addInput(project.music.assetId, "music", "mp3");
  for (const vo of project.voiceovers) await addInput(vo.assetId, "vo", "wav");
  check();

  const renderProject: VideoProject = { ...project, captions: { ...project.captions, showTranslated: opts.captionSource === "translated" } };
  const hasLayer = (opts.includeOverlays && project.overlays.length > 0) || (opts.includeCaptions && project.captions.visible && project.cues.length > 0);
  if (hasLayer) await ensureFontsLoaded();

  // Cuts sit on whole video and AAC frames so spliced fragments stay contiguous.
  const segments = plannedSegments(project, opts);
  const fragmented = segments.length > 1;
  const probes = new Map<string, MediaInfo>();
  let overlayFrames = 0;
  let capturedFrames = 0;

  const segmentJobs: RenderSegmentJob[] = segments.map((seg) => {
    const segLen = seg.end - seg.start;
    const label = segments.length > 1 ? ` (part ${seg.index + 1}/${segments.length})` : "";
    const useCompositor = opts.renderMode === "compositor" || (opts.renderMode === "auto" && needsCompositor(project, seg.start, seg.end));
    let args: string[] | null = null;
    return {
      index: seg.index,
      start: seg.start,
      end: seg.end,
      async prepare(ctx: SegmentContext) {
        const segLayouts = layoutClips(seg.clips);
        let idx = 0;
        const clipPlans: ClipInputPlan[] = [];
        const clipPaths: string[] = [];
        const clipAudio: (string | null)[] = [];
        for (const l of segLayouts) {
          const info = probes.get(l.clip.assetId);
          const hasAudio = info ? !!info.audio : l.clip.hasAudio;
          const hdr = opts.hdr === "passthrough" ? false : opts.hdr === "tonemap" ? true : !!info?.video?.isHdr;
          const inputIndex = idx++;
          let audioInputIndex: number | null = null;
          const audioName = l.clip.audioAssetId ? nameOf.get(l.clip.audioAssetId) : undefined;
          if (audioName) {
            audioInputIndex = idx++;
            clipAudio.push(ctx.inputPath(audioName));
          } else clipAudio.push(null);
          let lutPath: string | null = null;
          if (l.clip.look?.lutAssetId) {
            const lutBlob = await assets.getBlob(l.clip.look.lutAssetId);
            if (lutBlob) {
              lutPath = `/lut_${l.clip.look.lutAssetId}.cube`;
              if (!ctx.temp.includes(lutPath)) {
                await ctx.ffmpeg.writeFile(lutPath, new Uint8Array(await lutBlob.arrayBuffer()));
                ctx.temp.push(lutPath);
              }
            }
          }
          clipPlans.push({
            inputIndex,
            layout: l,
            placement: computePlacement({ width: l.clip.width, height: l.clip.height }, l.clip, frame),
            source: { width: l.clip.width, height: l.clip.height },
            hasAudio,
            audioInputIndex,
            hdr,
            lutPath,
          });
          clipPaths.push(ctx.inputPath(nameOf.get(l.clip.assetId)!));
        }

        let overlayInput: number | null = null;
        let overlayList: string | null = null;
        let framesInput: number | null = null;
        let framesPattern: string | null = null;

        if (useCompositor) {
          framesInput = idx++;
          const dir = `/fr${seg.index}`;
          await ctx.ffmpeg.createDir(dir).catch(() => undefined);
          onProgress({ stage: "frames", progress: seg.start / duration, message: `Rendering frames${label}` });
          const ext = opts.intermediate === "png" ? "png" : "jpg";
          const n = await captureFrames({
            project: renderProject,
            urls: assets.urls,
            frame,
            fps: opts.fps,
            from: seg.start,
            to: seg.end,
            images: assets.getImage,
            includeCaptions: opts.includeCaptions,
            includeOverlays: opts.includeOverlays,
            format: opts.intermediate === "png" ? "image/png" : "image/jpeg",
            quality: 0.93,
            signal,
            onFrame: async (data, i) => {
              const p = `${dir}/f${pad(i)}.${ext}`;
              await ctx.ffmpeg.writeFile(p, data);
              ctx.temp.push(p);
            },
            onProgress: (done, total) =>
              onProgress({ stage: "frames", progress: (seg.start + (done / Math.max(1, total)) * segLen) / duration, message: `Rendering frames ${done}/${total}${label}` }),
          });
          capturedFrames += n;
          framesPattern = `${dir}/f%05d.${ext}`;
        } else if (hasLayer) {
          overlayInput = idx++;
          const dir = `/ov${seg.index}`;
          await ctx.ffmpeg.createDir(dir).catch(() => undefined);
          const { canvas, ctx: c2d } = createCanvas(frame.width, frame.height);
          c2d.clearRect(0, 0, frame.width, frame.height);
          const blank = "blank.png";
          await ctx.ffmpeg.writeFile(`${dir}/${blank}`, await canvasToPng(canvas));
          ctx.temp.push(`${dir}/${blank}`);
          const times = overlayChangeTimes(renderProject, seg.start, seg.end, opts);
          const lines = ["ffconcat version 1.0"];
          let lastFile = blank;
          let local = 0;
          for (let i = 0; i < times.length; i++) {
            check();
            const start = times[i];
            const end = i + 1 < times.length ? times[i + 1] : seg.end;
            const len = end - start;
            if (len <= 0.0005) continue;
            const mid = start + len / 2;
            const anything =
              (opts.includeOverlays && renderProject.overlays.some((o) => isActive(o, mid))) ||
              (opts.includeCaptions && renderProject.captions.visible && renderProject.cues.some((c) => isActive(c, mid)));
            let file = blank;
            if (anything) {
              c2d.clearRect(0, 0, frame.width, frame.height);
              drawOverlayLayer(c2d, renderProject, mid, frame, { images: assets.getImage, includeCaptions: opts.includeCaptions, includeOverlays: opts.includeOverlays });
              file = `s${pad(local++, 4)}.png`;
              await ctx.ffmpeg.writeFile(`${dir}/${file}`, await canvasToPng(canvas));
              ctx.temp.push(`${dir}/${file}`);
              overlayFrames++;
            }
            lines.push(`file ${file}`, `duration ${len.toFixed(3)}`);
            lastFile = file;
            if (i % 8 === 0) onProgress({ stage: "overlays", progress: (seg.start + (i / times.length) * segLen) / duration, message: `Rendering captions ${i + 1}/${times.length}${label}` });
          }
          lines.push(`file ${lastFile}`);
          overlayList = `${dir}/list.txt`;
          await ctx.ffmpeg.writeFile(overlayList, lines.join("\n") + "\n");
          ctx.temp.push(overlayList);
        }

        let music: MusicPlan | null = null;
        let musicFile: ExportFiles["music"] = null;
        if (project.music && nameOf.has(project.music.assetId)) {
          const seek = musicSourceTime(project.music, seg.start);
          if (seek !== null) {
            music = { inputIndex: idx++, volume: project.music.volume, fadeIn: project.music.fadeIn, fadeOut: project.music.fadeOut, segmentStart: seg.start, totalDuration: duration };
            musicFile = { path: ctx.inputPath(nameOf.get(project.music.assetId)!), seek, loop: project.music.loop };
          }
        }
        const voiceovers: VoiceoverPlan[] = [];
        const voFiles: string[] = [];
        for (const vo of project.voiceovers) {
          const name = nameOf.get(vo.assetId);
          if (!name) continue;
          if (vo.start + vo.duration <= seg.start || vo.start >= seg.end) continue;
          voiceovers.push({ inputIndex: idx++, headTrim: Math.max(0, seg.start - vo.start), delay: Math.max(0, vo.start - seg.start), volume: vo.volume });
          voFiles.push(ctx.inputPath(name));
        }

        const isLast = seg.index === segments.length - 1;
        const plan: ExportPlan = {
          width: frame.width,
          height: frame.height,
          fps: opts.fps,
          duration: segLen,
          clips: clipPlans,
          overlayInput,
          framesInput,
          music,
          voiceovers,
          tsOffset: fragmented ? seg.start : 0,
          audioTailTrim: fragmented && !isLast ? AAC_PRIMING_SECONDS : 0,
        };
        const files: ExportFiles = { clips: clipPaths, clipAudio, overlayList, framesPattern, music: musicFile, voiceovers: voFiles, output: ctx.output };
        const { graph, vout, aout } = buildFilterGraph(plan);
        args = [
          "-hide_banner",
          "-y",
          ...buildInputArgs(plan, files),
          "-filter_complex",
          graph,
          "-map",
          `[${vout}]`,
          "-map",
          `[${aout}]`,
          ...encoderArgs(settings, { fragmented, tsOffset: seg.start, duration: segLen }),
          ctx.output,
        ];
      },
      args: () => {
        if (!args) throw new Error("Segment was not prepared");
        return args;
      },
    };
  });

  const job: RenderJob = {
    inputs,
    fragmented,
    duration,
    sink: out,
    beforeSegments: async (inputPath) => {
      const clipAssets = [...new Set(project.clips.map((c) => c.assetId))];
      for (const assetId of clipAssets) {
        check();
        probes.set(assetId, await ffmpegEngine.probe(inputPath(nameOf.get(assetId)!)));
      }
    },
    segments: segmentJobs,
  };

  const stats = await ffmpegEngine.render(
    job,
    (p) => {
      const stage: ExportStage = p.stage === "loading" ? "loading" : p.stage === "preparing" ? "preparing" : p.stage === "encoding" ? "encoding" : p.stage === "writing" ? "writing" : "done";
      if (p.stage !== "done") onProgress({ stage, progress: p.progress, message: p.message, ...(p.engine ? { engine: p.engine } : {}) });
    },
    signal,
  );
  onProgress({ stage: "finalizing", progress: 1, message: "Finishing file" });
  const video = await out.close();

  const useTranslated = opts.captionSource === "translated";
  const hasSpeakers = project.cues.some((c) => c.speaker !== undefined);
  const withCues = opts.sidecars && project.cues.length > 0;
  const srt = withCues ? new Blob([hasSpeakers ? toSpeakerSrt(project.cues, useTranslated) : toSrt(project.cues, useTranslated)], { type: "text/plain" }) : null;
  const txt = withCues ? new Blob([toTranscript(project.cues, useTranslated)], { type: "text/plain" }) : null;
  const vtt = withCues ? new Blob([toWebVtt(project.cues, { karaoke: true, speakers: hasSpeakers, translated: useTranslated })], { type: "text/vtt" }) : null;

  onProgress({ stage: "done", progress: 1, message: "Done" });
  return {
    video,
    fileName,
    srt,
    txt,
    vtt,
    info: stats.info,
    overlayFrames,
    capturedFrames,
    seconds: stats.seconds,
    bytes: stats.bytes,
    segments: stats.segments,
    streamed: out.kind === "disk",
    frame,
  };
}
