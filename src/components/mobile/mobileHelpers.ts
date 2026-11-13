import { isIOS } from "@/lib/mobile/audio";
import { WHISPER_MODELS } from "@/lib/speech/transcriber";

export type Step = "pick" | "analysing" | "style" | "exporting" | "done";

/** sessionStorage key holding the stage in progress. If it is still set
 * when the page loads, Safari restarted the tab mid-way (its silent
 * out-of-memory recovery) and the pick screen says so. */
const INFLIGHT_KEY = "nocap.mobile.inflight";
export const noopSubscribe = () => () => {};
export function readInflight(): string | null {
  try {
    return window.sessionStorage.getItem(INFLIGHT_KEY);
  } catch {
    return null;
  }
}
export function markInflight(stage: string | null) {
  try {
    if (stage) window.sessionStorage.setItem(INFLIGHT_KEY, stage);
    else window.sessionStorage.removeItem(INFLIGHT_KEY);
  } catch {
    /* storage blocked: the notice is a nicety */
  }
}
/** iPhone Safari tab (not yet on the Home Screen) → worth a one-line tip. */
export function readHomeScreenTip(): boolean {
  if (!isIOS()) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

/** Beyond this the phone can't realistically hold the audio + captions. */
export const MAX_SECONDS = 15 * 60;
/** From here on the export always streams to Blob storage instead of memory;
 * shorter clips stream only when the estimated file is large (shouldStream). */
export const LONG_SECONDS = 120;

export const MODEL_FAST = WHISPER_MODELS[0].id; // tiny
export const MODEL_ACCURATE = WHISPER_MODELS[1].id; // base
export const PREVIEW_MAX_EDGE = 1080;

export function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** onnxruntime couldn't get its wasm heap ("no available backend found … Out of memory"). */
export function isOutOfMemory(e: unknown): boolean {
  return /out of memory|no available backend/i.test(e instanceof Error ? e.message : String(e));
}
