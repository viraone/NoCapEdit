/**
 * Loads ffmpeg.wasm. The FFmpeg class proxies every command to a dedicated
 * Web Worker, so encoding never blocks the UI. The multi-threaded core is used
 * when the page is cross-origin isolated (SharedArrayBuffer available).
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { BASE_PATH } from "@/lib/basePath";

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
export function setSingleThreadPreference(on: boolean): void {
  try {
    if (on) localStorage.setItem("reelflow.singleThread", "1");
    else localStorage.removeItem("reelflow.singleThread");
  } catch {
    /* storage unavailable */
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

    const ffmpeg = new FFmpeg();
    if (debugFlag("debug")) ffmpeg.on("log", ({ message }) => console.debug("[ffmpeg]", message));
    await ffmpeg.load({ classWorkerURL, coreURL, wasmURL, ...(workerURL ? { workerURL } : {}) });
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
