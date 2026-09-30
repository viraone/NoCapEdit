/**
 * Getting the audio out of a phone video without blowing the phone's memory.
 *
 * `decodeAudioData` handles it on Chrome and desktop Safari, but iOS Safari
 * refuses to decode audio from a *video* container, and on any browser it
 * needs the whole file as an ArrayBuffer (a 4K iPhone clip is hundreds of
 * MB; Safari kills a tab that copies that around). So:
 *
 *  - iOS, or a file over WEB_AUDIO_MAX_BYTES: go straight to ffmpeg.
 *  - ffmpeg reads the file through a WORKERFS mount — the Blob is streamed
 *    into wasm on demand, never copied into the heap — and writes a small
 *    mono 48 kHz WAV that we parse by hand (no decodeAudioData involved).
 *
 * The result is decoded once and shared: 16 kHz mono for Whisper, 48 kHz
 * for the WebCodecs export.
 */

export const EXPORT_RATE = 48000;
export const SPEECH_RATE = 16000;
/** Above this, even browsers that could decodeAudioData a video shouldn't:
 * the ArrayBuffer copies cost more than the ffmpeg path. */
const WEB_AUDIO_MAX_BYTES = 120 * 1024 * 1024;

export interface SourceAudio {
  sampleRate: number;
  /** Planar float channels at `sampleRate` (1 or 2). */
  channels: Float32Array[];
  /** Mono 16 kHz, what Whisper expects. */
  speech: Float32Array;
  source: "webaudio" | "ffmpeg";
}

export type AudioStrategy = "auto" | "ffmpeg";

export function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function mixDown(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

export function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

function describe(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}

type Attempt = { channels: Float32Array[] } | { error: string };

async function viaWebAudio(file: Blob): Promise<Attempt> {
  try {
    const data = await file.arrayBuffer();
    const ctx = new OfflineAudioContext(2, 1, EXPORT_RATE);
    const buffer = await ctx.decodeAudioData(data);
    if (!buffer || buffer.length === 0) return { error: "decoded zero samples" };
    const n = Math.min(2, buffer.numberOfChannels);
    const channels: Float32Array[] = [];
    for (let c = 0; c < n; c++) channels.push(buffer.getChannelData(c));
    return { channels };
  } catch (e) {
    return { error: describe(e) };
  }
}

/** Parses a 16-bit PCM RIFF/WAVE file into planar float channels. */
export function parseWav(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Not a WAV file");
  let pos = 12;
  let numChannels = 0;
  let sampleRate = 0;
  let bits = 0;
  let dataStart = -1;
  let dataLen = 0;
  while (pos + 8 <= bytes.length) {
    const id = tag(pos);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      numChannels = view.getUint16(pos + 10, true);
      sampleRate = view.getUint32(pos + 12, true);
      bits = view.getUint16(pos + 22, true);
    } else if (id === "data") {
      dataStart = pos + 8;
      dataLen = Math.min(size, bytes.length - dataStart);
      break;
    }
    pos += 8 + size + (size & 1);
  }
  if (dataStart < 0 || !numChannels || !sampleRate || bits !== 16) throw new Error("Unsupported WAV layout");
  const frames = Math.floor(dataLen / (2 * numChannels));
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames));
  let p = dataStart;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      channels[c][i] = view.getInt16(p, true) / 32768;
      p += 2;
    }
  }
  return { sampleRate, channels };
}

const MOUNT = "/lite-in";

async function viaFfmpeg(file: Blob, onStatus?: (m: string) => void): Promise<Attempt> {
  let stage = "loading the video engine";
  try {
    const [{ loadFFmpeg }, { FFFSType }] = await Promise.all([import("@/lib/ffmpeg/loader"), import("@ffmpeg/ffmpeg")]);
    const { ffmpeg } = await loadFFmpeg({ forceSingleThread: true, onStatus });
    stage = "opening the file";
    onStatus?.("Extracting audio");
    // WORKERFS: ffmpeg reads the Blob lazily; nothing is copied into wasm memory.
    await ffmpeg.createDir(MOUNT).catch(() => undefined);
    await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: "src", data: file }] }, MOUNT);
    const onProgress = ({ progress }: { progress: number }) => {
      if (progress > 0 && progress <= 1) onStatus?.(`Extracting audio · ${Math.round(progress * 100)}%`);
    };
    ffmpeg.on("progress", onProgress);
    try {
      stage = "extracting audio";
      const code = await ffmpeg.exec(["-i", `${MOUNT}/src`, "-vn", "-ac", "1", "-ar", String(EXPORT_RATE), "-c:a", "pcm_s16le", "-f", "wav", "lite-audio.wav"]);
      if (code !== 0) return { error: `ffmpeg exited with ${code} (no audio stream?)` };
      stage = "parsing audio";
      const out = await ffmpeg.readFile("lite-audio.wav");
      if (typeof out === "string") return { error: "unexpected text output" };
      const { channels } = parseWav(out);
      return channels.length ? { channels } : { error: "WAV had no channels" };
    } finally {
      ffmpeg.off("progress", onProgress);
      await Promise.allSettled([ffmpeg.deleteFile("lite-audio.wav"), ffmpeg.unmount(MOUNT).then(() => ffmpeg.deleteDir(MOUNT))]);
    }
  } catch (e) {
    return { error: `${stage}: ${describe(e)}` };
  }
}

/** Both extraction paths failed; `message` carries each path's reason. */
export class AudioExtractError extends Error {
  constructor(public readonly reasons: { webaudio?: string; ffmpeg?: string }) {
    super(
      [reasons.webaudio && `Web Audio — ${reasons.webaudio}`, reasons.ffmpeg && `ffmpeg — ${reasons.ffmpeg}`].filter(Boolean).join(" · "),
    );
    this.name = "AudioExtractError";
  }
}

export async function extractAudio(
  file: Blob,
  opts: { strategy?: AudioStrategy; onStatus?: (message: string) => void } = {},
): Promise<SourceAudio> {
  const reasons: { webaudio?: string; ffmpeg?: string } = {};
  let channels: Float32Array[] | null = null;
  let source: SourceAudio["source"] = "webaudio";
  const tryWebAudio = opts.strategy !== "ffmpeg" && !isIOS() && file.size <= WEB_AUDIO_MAX_BYTES;
  if (tryWebAudio) {
    const r = await viaWebAudio(file);
    if ("channels" in r) channels = r.channels;
    else reasons.webaudio = r.error;
  } else if (opts.strategy !== "ffmpeg") {
    reasons.webaudio = isIOS() ? "skipped on iOS" : "skipped (file over 120 MB)";
  }
  if (!channels) {
    const r = await viaFfmpeg(file, opts.onStatus);
    if ("channels" in r) channels = r.channels;
    else reasons.ffmpeg = r.error;
    source = "ffmpeg";
  }
  if (!channels) throw new AudioExtractError(reasons);
  const speech = resampleLinear(mixDown(channels), EXPORT_RATE, SPEECH_RATE);
  return { sampleRate: EXPORT_RATE, channels, speech, source };
}
