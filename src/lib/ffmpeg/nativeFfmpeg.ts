/**
 * The real ffmpeg program, when the page runs inside the desktop app (docs/DESKTOP_PLAN.md, step 5).
 *
 * `NativeFFmpeg` has the same methods the export code calls on ffmpeg.wasm's `FFmpeg` class
 * (writeFile, exec, readFile, mount ...), so the loader can hand it out in its place and nothing
 * else changes. Files go to a private temporary folder kept by the desktop shell
 * (desktop/ffmpegHost.mjs); commands run there in the real program.
 *
 * On the website `window.nocapDesktop` does not exist and none of this is used.
 */

/** What desktop/preload.cjs exposes. */
export interface DesktopFfmpegBridge {
  info(): Promise<{ available: boolean; version?: string; missing?: string[]; encoders?: string[] }>;
  open(): Promise<string>;
  close(id: string): Promise<void>;
  write(id: string, name: string, data: Uint8Array, append?: boolean): Promise<void>;
  read(id: string, name: string): Promise<Uint8Array>;
  mkdir(id: string, name: string): Promise<void>;
  remove(id: string, name: string): Promise<void>;
  exec(id: string, args: string[]): Promise<{ code: number; refused?: string; unsupported?: string[]; crashed?: string }>;
  onLog(id: string, fn: ((line: string) => void) | null): void;
}

declare global {
  interface Window {
    nocapDesktop?: {
      isDesktop: boolean;
      ffmpeg?: DesktopFfmpegBridge;
      studio?: { info(): Promise<{ available: boolean; model?: string; name?: string }> };
      phone?: import("@/lib/phone/phoneBridge").DesktopPhoneBridge;
      caption?: { info(): Promise<{ available: boolean; model?: string }>; polish(notes: string): Promise<string> };
    };
  }
}

/** The word used for `FFmpegHungError.why` when the real ffmpeg gives up a step to the built-in engine. */
export const NATIVE_GAVE_UP = "could not run this step";

/** Thrown by `NativeFFmpeg.exec` when the real ffmpeg did not or could not run a command. The built-in engine takes over. */
export class NativeFfmpegError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeFfmpegError";
  }
}

type LogCallback = (event: { type: string; message: string }) => void;
type MountOptions = { blobs?: { name: string; data: Blob }[]; files?: File[] };

/** Bytes sent to the shell per message when copying media into the work folder. */
const CHUNK_BYTES = 16 * 1024 * 1024;

let disabledReason: string | null = null;

/** Stops using the real ffmpeg until the page is reloaded (after it failed a step). */
export function disableNativeFfmpeg(reason: string) {
  disabledReason = reason;
}

/** Why the real ffmpeg is switched off for this page load, or null. */
export function nativeFfmpegDisabledReason(): string | null {
  return disabledReason;
}

function bridge(): DesktopFfmpegBridge | null {
  if (typeof window === "undefined") return null;
  return window.nocapDesktop?.ffmpeg ?? null;
}

/** `localStorage reelflow.nativeFfmpeg = "0"` keeps the desktop app on the built-in engine. */
function switchedOff(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem("reelflow.nativeFfmpeg") === "0";
  } catch {
    return false;
  }
}

export class NativeFFmpeg {
  loaded = true;
  private listeners = new Set<LogCallback>();
  private terminated = false;

  constructor(
    private readonly api: DesktopFfmpegBridge,
    private readonly id: string,
    readonly version: string,
  ) {
    api.onLog(id, (line) => {
      for (const fn of this.listeners) fn({ type: "stderr", message: line });
    });
  }

  on(event: string, callback: LogCallback) {
    if (event === "log") this.listeners.add(callback);
  }

  off(event: string, callback: LogCallback) {
    if (event === "log") this.listeners.delete(callback);
  }

  private alive() {
    // Same words ffmpeg.wasm uses, so callers that look for a terminated engine behave the same.
    if (this.terminated) throw new Error("called FFmpeg.terminate()");
  }

  async exec(args: string[]): Promise<number> {
    this.alive();
    const result = await this.api.exec(this.id, args);
    this.alive();
    if (result.refused) throw new NativeFfmpegError(result.refused);
    if (result.unsupported?.length) throw new NativeFfmpegError(`The ffmpeg on this Mac lacks ${result.unsupported.join(", ")}.`);
    if (result.crashed) throw new NativeFfmpegError(result.crashed);
    return result.code;
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<boolean> {
    this.alive();
    await this.api.write(this.id, path, typeof data === "string" ? new TextEncoder().encode(data) : data, false);
    return true;
  }

  async readFile(path: string, encoding?: string): Promise<Uint8Array | string> {
    this.alive();
    const data = await this.api.read(this.id, path);
    return encoding === "utf8" ? new TextDecoder().decode(data) : data;
  }

  async deleteFile(path: string): Promise<boolean> {
    this.alive();
    await this.api.remove(this.id, path);
    return true;
  }

  async createDir(path: string): Promise<boolean> {
    this.alive();
    await this.api.mkdir(this.id, path);
    return true;
  }

  async deleteDir(path: string): Promise<boolean> {
    this.alive();
    await this.api.remove(this.id, path);
    return true;
  }

  /** ffmpeg.wasm mounts Blobs without copying. Here each one is copied into the work folder, in pieces. */
  async mount(_fsType: unknown, options: MountOptions, mountPoint: string): Promise<boolean> {
    this.alive();
    const items = [...(options.blobs ?? []), ...(options.files ?? []).map((f) => ({ name: f.name, data: f as Blob }))];
    await this.api.mkdir(this.id, mountPoint);
    for (const item of items) {
      const target = `${mountPoint}/${item.name}`;
      if (item.data.size === 0) await this.api.write(this.id, target, new Uint8Array(0), false);
      for (let offset = 0; offset < item.data.size; offset += CHUNK_BYTES) {
        this.alive();
        const piece = new Uint8Array(await item.data.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
        await this.api.write(this.id, target, piece, offset > 0);
      }
    }
    return true;
  }

  async unmount(mountPoint: string): Promise<boolean> {
    this.alive();
    await this.api.remove(this.id, mountPoint);
    return true;
  }

  /** Stops a running command and deletes the work folder. */
  terminate() {
    if (this.terminated) return;
    this.terminated = true;
    this.loaded = false;
    this.listeners.clear();
    this.api.onLog(this.id, null);
    void this.api.close(this.id).catch(() => undefined);
  }
}

/**
 * A ready NativeFFmpeg when the page is in the desktop app and a usable ffmpeg was found;
 * null otherwise (the website, a Mac with no ffmpeg, switched off, or after it failed a step).
 */
export async function openNativeFfmpeg(): Promise<NativeFFmpeg | null> {
  const api = bridge();
  if (!api || disabledReason || switchedOff()) return null;
  try {
    const info = await api.info();
    if (!info.available) return null;
    return new NativeFFmpeg(api, await api.open(), info.version ?? "unknown");
  } catch {
    return null;
  }
}
