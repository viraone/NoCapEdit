/**
 * Auto-reframing: detects the main face with MediaPipe Face Detector
 * (BlazeFace, WebGL/WebGPU delegate) at a few frames per second, smooths the
 * subject path and converts it into pan keyframes that keep the subject
 * centred inside the target frame (e.g. a 16:9 talking-head source inside a
 * 9:16 reel). The wasm runtime is self-hosted; the ~200 KB model is fetched
 * from Google's public model bucket the first time.
 */
import type { Clip, Keyframe } from "@/lib/models/project";
import type { Frame } from "@/lib/captions/renderer";
import { computePlacement } from "@/lib/models/placement";
import { clamp } from "@/lib/utils/math";

export const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
const WASM_BASE = "/mediapipe/wasm";

export interface SubjectSample {
  /** Source time in seconds. */
  t: number;
  /** Subject centre as fractions of the source frame. */
  x: number;
  y: number;
  /** Face box size as a fraction of the source width. */
  size: number;
}

export interface ReframeOptions {
  videoUrl: string;
  clip: Clip;
  frame: Frame;
  /** Analysis rate in frames per second. */
  fps?: number;
  onProgress?: (message: string, progress: number | null) => void;
  signal?: AbortSignal;
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

async function loadDetector(onProgress?: ReframeOptions["onProgress"]) {
  onProgress?.("Loading face detector", null);
  const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const create = (delegate: "GPU" | "CPU") =>
    FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 });
  try {
    return await create("GPU");
  } catch {
    return await create("CPU");
  }
}

/** Detects the largest face over the clip's trimmed range. */
export async function detectSubjectPath(o: ReframeOptions): Promise<SubjectSample[]> {
  const detector = await loadDetector(o.onProgress);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("Could not load the clip for analysis"));
    video.src = o.videoUrl;
  });
  const fps = o.fps ?? 4;
  const samples: SubjectSample[] = [];
  const { inPoint, outPoint } = o.clip;
  const total = Math.max(1, Math.ceil((outPoint - inPoint) * fps));
  try {
    for (let i = 0; i <= total; i++) {
      if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const t = Math.min(outPoint, inPoint + i / fps);
      await seek(video, t);
      const result = detector.detect(video);
      const best = result.detections
        .map((d) => d.boundingBox)
        .filter((b): b is NonNullable<typeof b> => !!b)
        .sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (best) {
        samples.push({
          t,
          x: (best.originX + best.width / 2) / video.videoWidth,
          y: (best.originY + best.height / 2) / video.videoHeight,
          size: best.width / video.videoWidth,
        });
      }
      o.onProgress?.(`Scanning ${Math.round(t - inPoint)}s / ${Math.round(outPoint - inPoint)}s · ${samples.length} detections`, i / total);
    }
  } finally {
    detector.close();
    video.removeAttribute("src");
    video.load();
  }
  return samples;
}

/** Smooths a subject path with a centred moving average over `windowSeconds`. */
export function smoothPath(samples: SubjectSample[], windowSeconds = 1.2): SubjectSample[] {
  return samples.map((s, i) => {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let j = i; j >= 0 && s.t - samples[j].t <= windowSeconds / 2; j--) {
      sx += samples[j].x;
      sy += samples[j].y;
      n++;
    }
    for (let j = i + 1; j < samples.length && samples[j].t - s.t <= windowSeconds / 2; j++) {
      sx += samples[j].x;
      sy += samples[j].y;
      n++;
    }
    return { ...s, x: sx / n, y: sy / n };
  });
}

/**
 * Converts subject positions into pan keyframes (source time) that keep the
 * subject centred, clamped so the frame stays fully covered by the source.
 */
export function subjectPathToPan(samples: SubjectSample[], clip: Clip, frame: Frame): Keyframe[] {
  const p = computePlacement({ width: clip.width, height: clip.height }, { zoom: clip.zoom, pan: { x: 0, y: 0 } }, frame);
  const maxPanX = Math.max(0, (p.dw - frame.width) / 2 / frame.width);
  const maxPanY = Math.max(0, (p.dh - frame.height) / 2 / frame.height);
  return samples.map((s) => {
    const sx = s.x * clip.width * p.scale;
    const sy = s.y * clip.height * p.scale;
    const dx = frame.width / 2 - sx;
    const dy = frame.height / 2 - sy;
    const panX = (dx - (frame.width - p.dw) / 2) / frame.width;
    const panY = (dy - (frame.height - p.dh) / 2) / frame.height;
    return { t: s.t, x: clamp(panX, -maxPanX, maxPanX), y: clamp(panY, -maxPanY, maxPanY) };
  });
}

export async function autoReframe(o: ReframeOptions): Promise<Keyframe[]> {
  const samples = await detectSubjectPath(o);
  if (samples.length < 2) throw new Error("No face was detected in this clip. Try a clip where the subject is visible.");
  return subjectPathToPan(smoothPath(samples), o.clip, o.frame);
}
