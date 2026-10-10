/**
 * Auto-reframing: finds the person with MediaPipe (pose landmarks, WebGL/WebGPU
 * delegate) at a few frames per second, notes where the source cuts to another
 * shot, and hands the path to cameraPath, which moves the pan like a camera
 * operator so their head stays centred inside the target frame (e.g. a 16:9
 * stage shot inside a 9:16 reel). The wasm runtime is self-hosted; the models
 * (~5 MB pose, ~200 KB face) are fetched from Google's public bucket the first time.
 */
import type { Clip, Keyframe } from "@/lib/models/project";
import type { Frame } from "@/lib/captions/renderer";
import type { PoseLandmarker as PoseLandmarkerT } from "@mediapipe/tasks-vision";
import { withBase } from "@/lib/basePath";
import { seekFrame } from "@/lib/media/seekFrame";
import { cameraPath, type SubjectSample } from "./cameraPath";

export { cameraPath, subjectPathToPan, type SubjectSample } from "./cameraPath";

export const FACE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
export const POSE_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const WASM_BASE = withBase("/mediapipe/wasm");

/** Mean brightness difference between two sampled frames above which the shot has changed (a cut). */
export const CUT_DIFF = 0.1;
const PROBE_W = 32;
const PROBE_H = 18;

/** Tiny greyscale copy of the current video frame, for telling one shot from the next. */
function probeFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement): Float32Array {
  ctx.drawImage(video, 0, 0, PROBE_W, PROBE_H);
  const d = ctx.getImageData(0, 0, PROBE_W, PROBE_H).data;
  const g = new Float32Array(PROBE_W * PROBE_H);
  for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114) / 255;
  return g;
}

export function frameDiff(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
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

interface Found {
  x: number;
  y: number;
  size: number;
}

interface Locator {
  /** Head position in the current frame (fractions of the source), or null when nobody is seen. */
  locate(video: HTMLVideoElement): Found | null;
  close(): void;
}

/** Head position from pose landmarks: the nose when seen, else between the ears, else just above the shoulders. */
export function headOf(lm: { x: number; y: number; visibility?: number }[]): Found | null {
  const [nose, lEar, rEar, lSh, rSh] = [lm[0], lm[7], lm[8], lm[11], lm[12]];
  const seen = (p?: { visibility?: number }) => !!p && (p.visibility ?? 1) > 0.5;
  const size = lSh && rSh ? Math.abs(lSh.x - rSh.x) : 0;
  if (seen(nose)) return { x: nose.x, y: nose.y, size };
  if (seen(lEar) && seen(rEar)) return { x: (lEar.x + rEar.x) / 2, y: (lEar.y + rEar.y) / 2, size };
  if (seen(lSh) && seen(rSh)) return { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 - size * 0.8, size };
  return null;
}

/**
 * The pose model sees whole bodies at a distance, which is what a wide stage
 * shot is; the close-range face model on its own took a lit window for a face
 * on such shots. The face model is the fallback when the pose model cannot be
 * loaded (offline) or sees nobody, and then the most confident face wins.
 */
async function loadLocator(onProgress?: ReframeOptions["onProgress"]): Promise<Locator> {
  onProgress?.("Loading the person detector", null);
  const { FilesetResolver, FaceDetector, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  const gpuThenCpu = async <T,>(create: (delegate: "GPU" | "CPU") => Promise<T>) => {
    try {
      return await create("GPU");
    } catch {
      return await create("CPU");
    }
  };
  const face = await gpuThenCpu((delegate) => FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 }));
  let pose: PoseLandmarkerT | null = null;
  try {
    pose = await gpuThenCpu((delegate) => PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate }, runningMode: "IMAGE", numPoses: 1, minPoseDetectionConfidence: 0.5 }));
  } catch {
    /* faces only */
  }
  return {
    locate(video) {
      const lm = pose?.detect(video).landmarks[0];
      const head = lm ? headOf(lm) : null;
      if (head) return head;
      const best = face
        .detect(video)
        .detections.filter((d) => d.boundingBox)
        .sort((a, b) => (b.categories[0]?.score ?? 0) - (a.categories[0]?.score ?? 0))[0];
      const b = best?.boundingBox;
      if (!b) return null;
      return { x: (b.originX + b.width / 2) / video.videoWidth, y: (b.originY + b.height / 2) / video.videoHeight, size: b.width / video.videoWidth };
    },
    close() {
      pose?.close();
      face.close();
    },
  };
}

/** Follows the person over the clip's trimmed range, noting cuts between shots. */
export async function detectSubjectPath(o: ReframeOptions): Promise<SubjectSample[]> {
  const locator = await loadLocator(o.onProgress);
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
  let skipped = 0;
  let cuts = 0;
  const probe = document.createElement("canvas");
  probe.width = PROBE_W;
  probe.height = PROBE_H;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  let prevGray: Float32Array | null = null;
  let prevT = inPoint;
  /** A cut seen since the last face sample, waiting to be attached to the next one. */
  let cutAt: number | null = null;
  try {
    for (let i = 0; i <= total; i++) {
      if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const t = Math.min(outPoint, inPoint + i / fps);
      // A seek that times out leaves the previous frame on screen; detecting
      // on it would pin the subject to a stale position, so the sample is skipped.
      if (!(await seekFrame(video, t))) {
        skipped++;
        continue;
      }
      if (pctx) {
        const gray = probeFrame(pctx, video);
        if (prevGray && frameDiff(gray, prevGray) > CUT_DIFF) {
          // The shot changed somewhere between the two samples: bisect to the frame it changed on.
          let lo = prevT;
          let hi = t;
          for (let k = 0; k < 3 && hi - lo > 0.04; k++) {
            const mid = (lo + hi) / 2;
            if (!(await seekFrame(video, mid))) break;
            if (frameDiff(probeFrame(pctx, video), prevGray) > CUT_DIFF) hi = mid;
            else lo = mid;
          }
          cutAt = hi;
          cuts++;
          if (!(await seekFrame(video, t))) {
            skipped++;
            prevGray = null;
            continue;
          }
        }
        prevGray = gray;
        prevT = t;
      }
      const found = locator.locate(video);
      if (found) {
        samples.push({ t, ...found, ...(cutAt !== null ? { cut: true, cutAt } : {}) });
        cutAt = null;
      }
      // Counts frames with a person, not people: one speaker seen 12 times reads "seen in 12 frames".
      const seen = samples.length ? `seen in ${samples.length} frame${samples.length === 1 ? "" : "s"}` : "nobody seen yet";
      const shots = cuts ? ` · ${cuts} cut${cuts === 1 ? "" : "s"}` : "";
      o.onProgress?.(`Scanning ${Math.round(t - inPoint)} s of ${Math.round(outPoint - inPoint)} s · ${seen}${shots}${skipped ? ` · ${skipped} frame${skipped === 1 ? "" : "s"} skipped` : ""}`, i / total);
    }
  } finally {
    locator.close();
    video.removeAttribute("src");
    video.load();
  }
  return samples;
}

export async function autoReframe(o: ReframeOptions): Promise<Keyframe[]> {
  const samples = await detectSubjectPath(o);
  if (samples.length < 2) throw new Error("Nobody was found in this clip. Try a clip where the person is in view.");
  return cameraPath(samples, o.clip, o.frame);
}
