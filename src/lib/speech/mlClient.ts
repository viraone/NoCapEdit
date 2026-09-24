/** Main-thread client for the ML worker (Whisper + translation). */
import type { MlRequest, MlResponse } from "./ml.worker";

export interface MlProgress {
  stage: string;
  message: string;
  progress: number | null;
  partialText?: string;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  onProgress?: (p: MlProgress) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./ml.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<MlResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === "progress") p.onProgress?.({ stage: msg.stage, message: msg.message, progress: msg.progress, partialText: msg.partialText });
    else if (msg.type === "result") {
      pending.delete(msg.id);
      p.resolve(msg.payload);
    } else if (msg.type === "error") {
      pending.delete(msg.id);
      p.reject(new Error(msg.message));
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "ML worker crashed");
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Terminates the worker, failing every in-flight request. */
export function resetMlWorker(reason = "Cancelled") {
  const err = new DOMException(reason, "AbortError");
  for (const p of pending.values()) p.reject(err);
  pending.clear();
  worker?.terminate();
  worker = null;
}

export function mlRequest<T>(
  build: (id: number) => MlRequest,
  onProgress?: (p: MlProgress) => void,
  signal?: AbortSignal,
  transfer: Transferable[] = [],
): Promise<T> {
  if (signal?.aborted) return Promise.reject(new DOMException("Cancelled", "AbortError"));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: (v) => resolve(v as T), reject, onProgress });
    const onAbort = () => resetMlWorker();
    signal?.addEventListener("abort", onAbort, { once: true });
    getWorker().postMessage(build(id), transfer);
  });
}
