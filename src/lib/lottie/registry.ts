/**
 * Lottie (.lottie / .json) animations rendered with dotlottie-web into an
 * offscreen canvas that the compositor draws each frame. Frames are set
 * explicitly from project time, so preview and export stay deterministic.
 */
import { withBase } from "@/lib/basePath";
import { getAsset } from "@/lib/storage/db";

interface PlayerLike {
  setFrame(frame: number): void;
  readonly totalFrames: number;
  readonly duration: number;
  readonly isLoaded: boolean;
  addEventListener(name: string, fn: () => void): void;
  destroy?(): void;
}

interface Entry {
  canvas: HTMLCanvasElement;
  player: PlayerLike | null;
  ready: boolean;
  error: string | null;
  totalFrames: number;
  duration: number;
  lastFrame: number;
}

const entries = new Map<string, Entry>();
let wasmConfigured = false;
const SIZE = 512;

async function createPlayer(canvas: HTMLCanvasElement, data: string | ArrayBuffer): Promise<PlayerLike> {
  const mod = await import("@lottiefiles/dotlottie-web");
  if (!wasmConfigured) {
    wasmConfigured = true;
    try {
      const url = withBase("/lottie/dotlottie-player.wasm");
      const head = await fetch(url, { method: "HEAD" });
      if (head.ok) mod.DotLottie.setWasmUrl(url);
    } catch {
      /* keep the library default (CDN) */
    }
  }
  const DotLottie = mod.DotLottie as unknown as new (opts: Record<string, unknown>) => PlayerLike;
  return new DotLottie({ canvas, data, autoplay: false, loop: false, renderConfig: { autoResize: false, devicePixelRatio: 1 } });
}

/** Loads (once) the animation for an asset. Resolves when frames can be drawn. */
export async function ensureLottie(assetId: string): Promise<Entry> {
  const existing = entries.get(assetId);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const entry: Entry = { canvas, player: null, ready: false, error: null, totalFrames: 0, duration: 0, lastFrame: -1 };
  entries.set(assetId, entry);
  try {
    const asset = await getAsset(assetId);
    if (!asset) throw new Error("Animation file is missing");
    const isJson = asset.type.includes("json") || asset.name.toLowerCase().endsWith(".json");
    const data = isJson ? await asset.blob.text() : await asset.blob.arrayBuffer();
    const player = await createPlayer(canvas, data);
    await new Promise<void>((resolve, reject) => {
      if (player.isLoaded) return resolve();
      player.addEventListener("load", () => resolve());
      player.addEventListener("loadError", () => reject(new Error("Could not load the animation")));
      setTimeout(() => (player.isLoaded ? resolve() : reject(new Error("Animation load timed out"))), 15000);
    });
    entry.player = player;
    entry.totalFrames = Math.max(1, player.totalFrames);
    entry.duration = player.duration || entry.totalFrames / 30;
    entry.ready = true;
  } catch (e) {
    entry.error = e instanceof Error ? e.message : String(e);
  }
  return entry;
}

export function lottieInfo(assetId: string): { ready: boolean; duration: number } | null {
  const e = entries.get(assetId);
  return e ? { ready: e.ready, duration: e.duration } : null;
}

/** Returns the canvas showing the animation at project time `t`, or null while loading. */
export function lottieFrame(assetId: string, t: number, start: number, speed: number, loop: boolean): HTMLCanvasElement | null {
  const e = entries.get(assetId);
  if (!e) {
    void ensureLottie(assetId);
    return null;
  }
  if (!e.ready || !e.player) return null;
  const elapsed = Math.max(0, (t - start) * speed);
  const frameF = elapsed * (e.totalFrames / Math.max(0.001, e.duration));
  const frame = loop ? frameF % e.totalFrames : Math.min(e.totalFrames - 1, frameF);
  const rounded = Math.floor(frame);
  if (rounded !== e.lastFrame) {
    try {
      e.player.setFrame(rounded);
      e.lastFrame = rounded;
    } catch {
      return null;
    }
  }
  return e.canvas;
}

/** Preloads every Lottie overlay so offline capture never draws a blank. */
export async function preloadLotties(assetIds: string[]) {
  await Promise.all([...new Set(assetIds)].map((id) => ensureLottie(id)));
}
