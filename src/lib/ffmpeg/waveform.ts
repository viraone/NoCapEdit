/**
 * Client-side audio decoding with the Web Audio API. Produces 16 kHz mono
 * samples (what Whisper expects) and waveform peaks for the timeline.
 */

export interface DecodedAudio {
  samples: Float32Array;
  sampleRate: number;
  duration: number;
}

export interface Peaks {
  peaks: Uint8Array;
  perSecond: number;
  duration: number;
}

export const SPEECH_SAMPLE_RATE = 16000;

function mixDown(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < data.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

function resampleLinear(input: Float32Array, from: number, to: number): Float32Array {
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

/**
 * Decodes the audio track of any media Blob (video or audio) to mono samples
 * at `sampleRate`. Returns null when the file has no decodable audio.
 */
export async function decodeAudio(blob: Blob, sampleRate = SPEECH_SAMPLE_RATE): Promise<DecodedAudio | null> {
  const data = await blob.arrayBuffer();
  const attempt = async (rate: number) => {
    const ctx = new OfflineAudioContext(1, 1, rate);
    const decoded = await ctx.decodeAudioData(data.slice(0));
    return decoded;
  };
  let buffer: AudioBuffer | null = null;
  try {
    buffer = await attempt(sampleRate);
  } catch {
    // Some engines refuse low sample rates; decode at 44.1 kHz and resample.
    try {
      buffer = await attempt(44100);
    } catch {
      return null;
    }
  }
  if (!buffer || buffer.length === 0) return null;
  let samples = mixDown(buffer);
  if (buffer.sampleRate !== sampleRate) samples = resampleLinear(samples, buffer.sampleRate, sampleRate);
  return { samples, sampleRate, duration: samples.length / sampleRate };
}

/** Peak amplitude per bucket, quantised to 0..255. */
export function peaksFromSamples(samples: Float32Array, sampleRate: number, perSecond = 50): Peaks {
  const bucket = Math.max(1, Math.floor(sampleRate / perSecond));
  const count = Math.ceil(samples.length / bucket);
  const peaks = new Uint8Array(count);
  let max = 0;
  const raw = new Float32Array(count);
  for (let b = 0; b < count; b++) {
    let peak = 0;
    const end = Math.min(samples.length, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    raw[b] = peak;
    if (peak > max) max = peak;
  }
  // Normalise so quiet recordings still show a readable waveform.
  const norm = max > 0.05 ? max : 1;
  for (let b = 0; b < count; b++) peaks[b] = Math.min(255, Math.round((raw[b] / norm) * 255));
  return { peaks, perSecond, duration: samples.length / sampleRate };
}

export async function computePeaks(blob: Blob, perSecond = 50): Promise<Peaks | null> {
  const decoded = await decodeAudio(blob, SPEECH_SAMPLE_RATE);
  if (!decoded) return null;
  return peaksFromSamples(decoded.samples, decoded.sampleRate, perSecond);
}
