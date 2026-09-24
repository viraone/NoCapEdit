import { decodeAudio, type DecodedAudio } from "@/lib/ffmpeg/waveform";

const cache = new Map<string, Promise<DecodedAudio | null>>();
const MAX_ENTRIES = 3;

/** Decodes (once) the 16 kHz mono audio of an asset for speech recognition. */
export function getSpeechAudio(assetId: string, blob: Blob): Promise<DecodedAudio | null> {
  const hit = cache.get(assetId);
  if (hit) return hit;
  const p = decodeAudio(blob).catch(() => null);
  cache.set(assetId, p);
  if (cache.size > MAX_ENTRIES) {
    const first = cache.keys().next().value;
    if (first) cache.delete(first);
  }
  return p;
}

export function forgetSpeechAudio(assetId: string) {
  cache.delete(assetId);
}
