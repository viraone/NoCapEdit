/**
 * Loads ffmpeg.wasm. The FFmpeg class proxies every command to a dedicated
 * Web Worker, so encoding never blocks the UI. The multi-threaded core is used
 * when the page is cross-origin isolated (SharedArrayBuffer available).
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { BASE_PATH } from "@/lib/basePath";
import { withDeadline } from "./deadline";

const CORE_VERSION = "0.12.10";

export interface FFmpegInfo {
  multithreaded: boolean;
  source: "local" | "cdn";
}

let instance: FFmpeg | null = null;
let info: FFmpegInfo | null = null;
let loading: Promise<{ ffmpeg: FFmpeg; info: FFmpegInfo }> | null = null;

export function supportsMultithread(): boolean {
  return typeof SharedArrayBuffer !== "undefined" && typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
}

/** Debug switches stored in localStorage: reelflow.debug=1 logs ffmpeg output, reelflow.singleThread=1 forces the ST core. */
export function debugFlag(name: "debug" | "singleThread"): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(`reelflow.${name}`) === "1";
  } catch {
    return false;
  }
}

/**
 * Remembers that the multi-threaded core stalled on this device, so later
 * sessions go straight to the single-threaded core instead of waiting for the
 * watchdog again. The same key is the manual `reelflow.singleThread` switch.
 */
const singleThreadListeners = new Set<() => void>();

/** Notifies `cb` whenever setSingleThreadPreference runs (for useSyncExternalStore). Returns the unsubscribe. */
export function subscribeSingleThreadPreference(cb: () => void): () => void {
  singleThreadListeners.add(cb);
  return () => void singleThreadListeners.delete(cb);
}

export function setSingleThreadPreference(on: boolean): void {
  try {
    if (on) localStorage.setItem("reelflow.singleThread", "1");
    else localStorage.removeItem("reelflow.singleThread");
  } catch {
    /* storage unavailable */
  }
  // Called from the watchdog mid-export too: a listener error must never mask that path.
  for (const cb of singleThreadListeners) {
    try {
      cb();
    } catch {
      /* ignore */
    }
  }
}

export function singleThreadPreferred(): boolean {
  return debugFlag("singleThread");
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Seconds the engine may take to start. The threaded core pre-starts a pool of
 * 32 workers and ffmpeg.load() waits until every one has reported ready, with
 * no limit of its own: one that never does leaves the page waiting forever.
 * Starting normally takes a second or two. The clock starts only after the
 * engine's files are downloaded, so a slow connection is never mistaken for a stall.
 */
export const LOAD_STALL_SECONDS = 60;

/** The engine did not finish starting in time (see LOAD_STALL_SECONDS). */
export class FFmpegLoadStalled extends Error {
  readonly multithreaded: boolean;
  constructor(multithreaded: boolean) {
    super(multithreaded ? "The multi-threaded video engine did not start." : "The video engine did not start.");
    this.name = "FFmpegLoadStalled";
    this.multithreaded = multithreaded;
  }
}

export interface LoadOptions {
  forceSingleThread?: boolean;
  onStatus?: (message: string) => void;
}

export async function loadFFmpeg(opts: LoadOptions = {}): Promise<{ ffmpeg: FFmpeg; info: FFmpegInfo }> {
  if (instance?.loaded && info) return { ffmpeg: instance, info };
  if (loading) return loading;
  loading = (async () => {
    const base = `${location.origin}${BASE_PATH}/ffmpeg`;
    const mt = supportsMultithread() && !opts.forceSingleThread && !debugFlag("singleThread");
    const coreName = mt ? "core-mt" : "core";
    const localCore = `${base}/${coreName}`;
    const classWorkerURL = `${base}/ffmpeg/worker.js`;

    let coreURL: string;
    let wasmURL: string;
    let workerURL: string | undefined;
    let source: FFmpegInfo["source"] = "local";

    opts.onStatus?.("Loading video engine");
    if (await exists(`${localCore}/ffmpeg-core.wasm`)) {
      coreURL = `${localCore}/ffmpeg-core.js`;
      wasmURL = `${localCore}/ffmpeg-core.wasm`;
      workerURL = mt ? `${localCore}/ffmpeg-core.worker.js` : undefined;
    } else {
      // Some static hosts cap file sizes below the 32 MB core; fall back to a CDN.
      source = "cdn";
      const cdn = `https://unpkg.com/@ffmpeg/${coreName}@${CORE_VERSION}/dist/esm`;
      opts.onStatus?.("Downloading video engine (one time)");
      coreURL = await toBlobURL(`${cdn}/ffmpeg-core.js`, "text/javascript");
      wasmURL = await toBlobURL(`${cdn}/ffmpeg-core.wasm`, "application/wasm");
      workerURL = mt ? await toBlobURL(`${cdn}/ffmpeg-core.worker.js`, "text/javascript") : undefined;
    }

    // Fetch the engine's files first (a slow connection is a wait, not a stall); ffmpeg.load then finds them in the HTTP cache.
    if (source === "local") {
      await Promise.all([coreURL, wasmURL, workerURL].map(async (u) => {
        if (!u) return;
        try {
          await (await fetch(u, { cache: "force-cache" })).arrayBuffer();
        } catch {
          /* ffmpeg.load reports a real failure itself */
        }
      }));
    }

    const ffmpeg = new FFmpeg();
    if (debugFlag("debug")) ffmpeg.on("log", ({ message }) => console.debug("[ffmpeg]", message));
    await withDeadline(ffmpeg.load({ classWorkerURL, coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) }), LOAD_STALL_SECONDS * 1000, () => {
      // Kill the half-started worker so it does not linger, and let the next load start clean.
      try {
        ffmpeg.terminate();
      } catch {
        /* already gone */
      }
      return new FFmpegLoadStalled(mt);
    });
    if (debugFlag("debug")) console.debug("[ffmpeg] loaded", { multithreaded: mt, source, coreURL });
    instance = ffmpeg;
    info = { multithreaded: mt, source };
    return { ffmpeg, info };
  })();
  try {
    return await loading;
  } catch (e) {
    instance = null;
    info = null;
    throw e;
  } finally {
    loading = null;
  }
}

/** Kills the worker (used to cancel a render). The next load starts fresh. */
export function resetFFmpeg() {
  try {
    instance?.terminate();
  } catch {
    /* ignore */
  }
  instance = null;
  info = null;
  loading = null;
}
