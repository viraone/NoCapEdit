/** Main-thread client for the Kokoro voice worker, plus the list of Kokoro narrators. */
import type { KokoroRequest, KokoroResponse } from "./kokoro.worker";

export interface KokoroVoice {
  /** Prefixed with "kokoro:" so it can sit in the same list as the per-language voices. */
  id: string;
  name: string;
}

export const KOKORO_PREFIX = "kokoro:";

/** English narrators, American then British. The first is the default. */
export const KOKORO_VOICES: KokoroVoice[] = [
  { id: "kokoro:af_heart", name: "Heart (female, natural)" },
  { id: "kokoro:af_bella", name: "Bella (female, warm)" },
  { id: "kokoro:af_nicole", name: "Nicole (female, calm)" },
  { id: "kokoro:am_michael", name: "Michael (male)" },
  { id: "kokoro:am_fenrir", name: "Fenrir (male, deep)" },
  { id: "kokoro:bf_emma", name: "Emma (British female)" },
  { id: "kokoro:bm_george", name: "George (British male)" },
];

export const isKokoroVoice = (voiceId: string): boolean => voiceId.startsWith(KOKORO_PREFIX);

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: { audio: Float32Array; sampleRate: number }) => void; reject: (e: Error) => void; onProgress?: (message: string, progress: number | null) => void }>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./kokoro.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<KokoroResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") p.onProgress?.(msg.message, msg.progress);
    else if (msg.type === "result") {
      pending.delete(msg.id);
      p.resolve({ audio: msg.audio, sampleRate: msg.sampleRate });
    } else {
      pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "The voice worker crashed");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Stops the voice worker, failing anything in flight (used when a film is cancelled). */
export function resetKokoroWorker(): void {
  const err = new DOMException("Cancelled", "AbortError");
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker?.terminate();
  worker = null;
}

/** Speaks `text` with a Kokoro voice id ("kokoro:af_heart"); resolves with raw samples at 24 kHz. */
export function speakKokoro(text: string, voiceId: string, onProgress?: (message: string, progress: number | null) => void, signal?: AbortSignal): Promise<{ audio: Float32Array; sampleRate: number }> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    signal?.addEventListener("abort", resetKokoroWorker, { once: true });
    const req: KokoroRequest = { type: "speak", id, text, voice: voiceId.slice(KOKORO_PREFIX.length) };
    getWorker().postMessage(req);
  });
}
