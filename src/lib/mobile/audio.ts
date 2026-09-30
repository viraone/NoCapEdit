/**
 * Getting the audio out of a phone video. `decodeAudioData` handles it on
 * Chrome and desktop Safari, but iOS Safari refuses to decode audio from a
 * *video* container (MOV/MP4 with a video track) and also rejects low
 * sample-rate OfflineAudioContexts — so on the phone we fall back to a
 * single-threaded ffmpeg extraction to WAV, parsed by hand. The result is
 * decoded once and shared by Whisper (16 kHz mono) and the export (48 kHz).
 */

export const EXPORT_RATE = 48000;
export const SPEECH_RATE = 16000;

export interface SourceAudio {
  sampleRate: number;
  /** Planar float channels at `sampleRate` (1 or 2). */
  channels: Float32Array[];
  /** Mono 16 kHz, what Whisper expects. */
  speech: Float32Array;
  source: "webaudio" | "ffmpeg";
}

export type AudioStrategy = "auto" | "ffmpeg";

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

async function viaWebAudio(file: Blob): Promise<{ channels: Float32Array[] } | { error: string }> {
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

async function viaFfmpeg(file: Blob, onStatus?: (m: string) => void): Promise<{ channels: Float32Array[] } | { error: string }> {
  let stage = "loading the video engine";
  try {
    const { loadFFmpeg } = await import("@/lib/ffmpeg/loader");
    const { ffmpeg } = await loadFFmpeg({ forceSingleThread: true, onStatus });
    stage = "reading the file";
    onStatus?.("Extracting audio");
    await ffmpeg.writeFile("lite-audio-src", new Uint8Array(await file.arrayBuffer()));
    try {
      stage = "extracting audio";
      const code = await ffmpeg.exec(["-i", "lite-audio-src", "-vn", "-ac", "2", "-ar", String(EXPORT_RATE), "-c:a", "pcm_s16le", "-f", "wav", "lite-audio.wav"]);
      if (code !== 0) return { error: `ffmpeg exited with ${code} (no audio stream?)` };
      stage = "parsing audio";
      const out = await ffmpeg.readFile("lite-audio.wav");
      if (typeof out === "string") return { error: "unexpected text output" };
      const { channels } = parseWav(out);
      return channels.length ? { channels } : { error: "WAV had no channels" };
    } finally {
      await Promise.allSettled([ffmpeg.deleteFile("lite-audio-src"), ffmpeg.deleteFile("lite-audio.wav")]);
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
  if (opts.strategy !== "ffmpeg") {
    const r = await viaWebAudio(file);
    if ("channels" in r) channels = r.channels;
    else reasons.webaudio = r.error;
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
