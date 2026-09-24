/**
 * Pure builders for the ffmpeg command line. Kept free of browser APIs so the
 * graph construction is unit-testable.
 */
import type { ClipLayout } from "@/lib/models/timeline";
import type { Placement } from "@/lib/models/placement";
import { getGlTransition, isGlTransition } from "@/lib/gl/transitions";
import { hdrToSdrChain } from "@/lib/ffmpegEngine";

/** Maps a transition id to an ffmpeg xfade name (GPU shaders fall back to the nearest native effect). */
export function xfadeName(type: string): string {
  if (isGlTransition(type)) return getGlTransition(type)?.fallback ?? "fade";
  return type;
}

export interface ClipInputPlan {
  inputIndex: number;
  layout: ClipLayout;
  placement: Placement;
  source: { width: number; height: number };
  hasAudio: boolean;
  /** Input index of a replacement audio file (already seeked like the clip). */
  audioInputIndex?: number | null;
  /** Tone-map a 10-bit HDR source to SDR. */
  hdr?: boolean;
}

export interface MusicPlan {
  inputIndex: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** Project time at which this segment starts (fades are global). */
  segmentStart: number;
  /** Whole project duration (for the fade-out). */
  totalDuration: number;
}

export interface VoiceoverPlan {
  inputIndex: number;
  /** Seconds to drop from the head (when the segment starts mid-voice-over). */
  headTrim: number;
  /** Delay inside the segment, seconds >= 0. */
  delay: number;
  volume: number;
}

export interface ExportPlan {
  width: number;
  height: number;
  fps: number;
  /** Duration of this render (segment) in seconds. */
  duration: number;
  clips: ClipInputPlan[];
  /** Input index of the caption/overlay PNG concat stream (filters path). */
  overlayInput: number | null;
  /** Input index of a pre-composited frame sequence (compositor path). */
  framesInput: number | null;
  music: MusicPlan | null;
  voiceovers: VoiceoverPlan[];
  /** Project time of this segment's first frame (informational; the splicer shifts fragments). */
  tsOffset?: number;
  /** Seconds removed from the end of the audio (one AAC frame before a splice point). */
  audioTailTrim?: number;
}

/** AAC encoder priming (samples) that the next spliced segment carries at its head. */
export const AAC_PRIMING_SECONDS = 1024 / 48000;

export interface QualityProfile {
  preset: string;
  crf: number;
}

export const QUALITY_PROFILES: Record<"draft" | "balanced" | "high", QualityProfile & { label: string; note: string }> = {
  draft: { preset: "ultrafast", crf: 28, label: "Draft", note: "Fastest render, visible compression" },
  balanced: { preset: "veryfast", crf: 23, label: "Balanced", note: "Good quality for social platforms" },
  high: { preset: "medium", crf: 20, label: "High", note: "Best quality, slowest render" },
};

const AUDIO_RATE = 48000;
const AFORMAT = `aformat=sample_fmts=fltp:sample_rates=${AUDIO_RATE}:channel_layouts=stereo`;

/** Formats a number for a filter argument (no exponent notation). */
export const num = (n: number, decimals = 4): string => {
  const v = Number(n.toFixed(decimals));
  return Object.is(v, -0) ? "0" : v.toString();
};

/** Builds the atempo chain that keeps pitch, or asetrate that shifts it. */
export function speedFilters(speed: number, preservePitch: boolean): string[] {
  if (Math.abs(speed - 1) < 1e-6) return [];
  if (!preservePitch) return [`asetrate=${AUDIO_RATE * speed}`, `aresample=${AUDIO_RATE}`];
  const parts: string[] = [];
  let f = speed;
  while (f > 2) {
    parts.push("atempo=2");
    f /= 2;
  }
  while (f < 0.5) {
    parts.push("atempo=0.5");
    f *= 2;
  }
  if (Math.abs(f - 1) > 1e-6) parts.push(`atempo=${num(f, 6)}`);
  return parts;
}

interface CropRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Source crop that maps exactly onto the frame, or null when the frame shows padding. */
export function cropRegion(p: Placement, source: { width: number; height: number }, frame: { width: number; height: number }): CropRegion | null {
  const x = -p.dx / p.scale;
  const y = -p.dy / p.scale;
  const w = frame.width / p.scale;
  const h = frame.height / p.scale;
  const tol = 0.75;
  if (x < -tol || y < -tol || x + w > source.width + tol || y + h > source.height + tol) return null;
  const cx = Math.max(0, Math.round(x));
  const cy = Math.max(0, Math.round(y));
  const cw = Math.max(2, Math.min(source.width - cx, Math.round(w)));
  const ch = Math.max(2, Math.min(source.height - cy, Math.round(h)));
  return { x: cx, y: cy, w: cw, h: ch };
}

function videoChain(plan: ExportPlan, c: ClipInputPlan, i: number): string {
  const { clip } = c.layout;
  const dur = num(c.layout.duration);
  const hdr = c.hdr ? `${hdrToSdrChain()},` : "";
  const head = `[${c.inputIndex}:v]${hdr}setpts=(PTS-STARTPTS)/${num(clip.speed, 6)},fps=${plan.fps}`;
  const tail = `format=yuv420p,trim=duration=${dur},setpts=PTS-STARTPTS[v${i}]`;
  const crop = cropRegion(c.placement, c.source, { width: plan.width, height: plan.height });
  if (crop) {
    return `${head},crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},scale=${plan.width}:${plan.height}:flags=bicubic,setsar=1,${tail}`;
  }
  const dw = Math.max(2, Math.round(c.placement.dw));
  const dh = Math.max(2, Math.round(c.placement.dh));
  return (
    `${head},scale=${dw}:${dh}:flags=bicubic,setsar=1[vs${i}];` +
    `color=c=${(clip.background ?? "#000000").replace("#", "0x")}:s=${plan.width}x${plan.height}:r=${plan.fps}:d=${dur}[bg${i}];` +
    `[bg${i}][vs${i}]overlay=x=${Math.round(c.placement.dx)}:y=${Math.round(c.placement.dy)}:shortest=1,${tail}`
  );
}

function audioChain(c: ClipInputPlan, i: number): string {
  const { clip } = c.layout;
  const dur = num(c.layout.duration);
  const src = c.audioInputIndex !== null && c.audioInputIndex !== undefined ? c.audioInputIndex : c.hasAudio ? c.inputIndex : null;
  if (src === null) {
    return `anullsrc=r=${AUDIO_RATE}:cl=stereo,atrim=duration=${dur},asetpts=PTS-STARTPTS[a${i}]`;
  }
  const parts = [
    `[${src}:a]asetpts=PTS-STARTPTS`,
    `aresample=${AUDIO_RATE}`,
    ...speedFilters(clip.speed, clip.preservePitch),
    `volume=${num(clip.volume, 3)}`,
    AFORMAT,
    `atrim=duration=${dur}`,
    `asetpts=PTS-STARTPTS`,
  ];
  return `${parts.join(",")}[a${i}]`;
}

/** Volume expression that applies the global fade-in/out to a segment starting at S. */
export function musicGainExpression(m: MusicPlan): string {
  const terms: string[] = [];
  if (m.fadeIn > 0) terms.push(`(t+${num(m.segmentStart)})/${num(m.fadeIn)}`);
  if (m.fadeOut > 0) terms.push(`(${num(m.totalDuration)}-t-${num(m.segmentStart)})/${num(m.fadeOut)}`);
  if (!terms.length) return num(m.volume, 3);
  const inner = terms.length === 1 ? terms[0] : `min(${terms[0]},${terms[1]})`;
  return `${num(m.volume, 3)}*clip(${inner},0,1)`;
}

export function buildFilterGraph(plan: ExportPlan): { graph: string; vout: string; aout: string } {
  const parts: string[] = [];
  const dur = num(plan.duration);
  let v: string;
  let a = "a0";

  if (plan.framesInput !== null) {
    parts.push(`[${plan.framesInput}:v]fps=${plan.fps},format=yuv420p,setsar=1,trim=duration=${dur},setpts=PTS-STARTPTS[vbase]`);
    v = "vbase";
    plan.clips.forEach((c, i) => parts.push(audioChain(c, i)));
  } else {
    plan.clips.forEach((c, i) => {
      parts.push(videoChain(plan, c, i));
      parts.push(audioChain(c, i));
    });
    v = "v0";
  }

  for (let i = 1; i < plan.clips.length; i++) {
    const layout = plan.clips[i].layout;
    const t = layout.transitionIn;
    const type = plan.clips[i - 1].layout.clip.transition.type;
    const crossfade = t > 0.01 && type !== "none";
    if (plan.framesInput === null) {
      if (crossfade) parts.push(`[${v}][v${i}]xfade=transition=${xfadeName(type)}:duration=${num(t)}:offset=${num(layout.start)}[vx${i}]`);
      else parts.push(`[${v}][v${i}]concat=n=2:v=1:a=0[vx${i}]`);
      v = `vx${i}`;
    }
    if (crossfade) parts.push(`[${a}][a${i}]acrossfade=d=${num(t)}:c1=tri:c2=tri[ax${i}]`);
    else parts.push(`[${a}][a${i}]concat=n=2:v=0:a=1[ax${i}]`);
    a = `ax${i}`;
  }

  if (plan.overlayInput !== null && plan.framesInput === null) {
    parts.push(`[${v}][${plan.overlayInput}:v]overlay=x=0:y=0:eof_action=repeat[vov]`);
    v = "vov";
  }
  // A final fps pass regularises timestamps (xfade/overlay can leave sub-frame jitter).
  parts.push(`[${v}]format=yuv420p,fps=${plan.fps}[vout]`);

  const mixInputs = [a];
  if (plan.music) {
    const m = plan.music;
    parts.push(`[${m.inputIndex}:a]aresample=${AUDIO_RATE},${AFORMAT},asetpts=PTS-STARTPTS,volume=volume='${musicGainExpression(m)}':eval=frame,atrim=duration=${dur},asetpts=PTS-STARTPTS[mus]`);
    mixInputs.push("mus");
  }
  plan.voiceovers.forEach((vo, k) => {
    const chain = [`[${vo.inputIndex}:a]aresample=${AUDIO_RATE}`, AFORMAT];
    if (vo.headTrim > 0) chain.push(`atrim=start=${num(vo.headTrim)}`);
    chain.push(`asetpts=PTS-STARTPTS`, `volume=${num(vo.volume, 3)}`);
    if (vo.delay > 0) chain.push(`adelay=delays=${Math.round(vo.delay * 1000)}:all=1`);
    chain.push(`atrim=duration=${dur}`);
    parts.push(`${chain.join(",")}[vo${k}]`);
    mixInputs.push(`vo${k}`);
  });
  const audioTail = plan.audioTailTrim && plan.audioTailTrim > 0 ? `atrim=duration=${num(Math.max(0.01, plan.duration - plan.audioTailTrim))}` : "anull";
  if (mixInputs.length === 1) parts.push(`[${a}]${audioTail}[aout]`);
  else parts.push(`${mixInputs.map((l) => `[${l}]`).join("")}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0:normalize=0,${audioTail}[aout]`);

  return { graph: parts.join(";"), vout: "vout", aout: "aout" };
}

export interface ExportFiles {
  clips: string[];
  /** Replacement audio paths aligned with `clips` (null when none). */
  clipAudio?: (string | null)[];
  overlayList: string | null;
  /** image2 pattern, e.g. /fr0/f%05d.jpg */
  framesPattern: string | null;
  music: { path: string; seek: number; loop: boolean } | null;
  voiceovers: string[];
  output: string;
}

/** Input arguments in the order the plan's input indexes expect. */
export function buildInputArgs(plan: ExportPlan, files: ExportFiles): string[] {
  const args: string[] = [];
  plan.clips.forEach((c, i) => {
    const { clip } = c.layout;
    const seek = ["-ss", num(clip.inPoint), "-t", num(clip.outPoint - clip.inPoint)];
    args.push(...seek, "-i", files.clips[i]);
    const audio = files.clipAudio?.[i];
    if (audio) args.push(...seek, "-i", audio);
  });
  if (plan.overlayInput !== null && files.overlayList) args.push("-f", "concat", "-safe", "0", "-i", files.overlayList);
  if (plan.framesInput !== null && files.framesPattern) args.push("-framerate", String(plan.fps), "-start_number", "0", "-i", files.framesPattern);
  if (plan.music && files.music) {
    if (files.music.loop) args.push("-stream_loop", "-1");
    args.push("-ss", num(files.music.seek), "-t", num(plan.duration + 1), "-i", files.music.path);
  }
  for (const vo of files.voiceovers) args.push("-i", vo);
  return args;
}

/** Legacy single-pass command (kept for the simple CRF export path). */
export function buildExportArgs(plan: ExportPlan, files: ExportFiles, quality: QualityProfile): string[] {
  const args: string[] = ["-hide_banner", "-y", ...buildInputArgs(plan, files)];
  const { graph, vout, aout } = buildFilterGraph(plan);
  args.push("-filter_complex", graph, "-map", `[${vout}]`, "-map", `[${aout}]`);
  args.push(
    "-c:v", "libx264",
    "-preset", quality.preset,
    "-crf", String(quality.crf),
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-level", "4.1",
    "-r", String(plan.fps),
    "-c:a", "aac",
    "-b:a", "160k",
    "-ar", String(AUDIO_RATE),
    "-movflags", "+faststart",
    "-t", num(plan.duration),
    files.output,
  );
  return args;
}
