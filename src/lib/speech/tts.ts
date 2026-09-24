/**
 * Offline text-to-speech for voice-overs. MMS-TTS (VITS) models run inside the
 * ML worker via Transformers.js and return raw samples, which are encoded to
 * WAV so they can be mixed by the preview engine and by ffmpeg on export.
 * The browser's speechSynthesis is offered for instant previews only (its
 * audio cannot be captured into a file).
 */
import { mlRequest, type MlProgress } from "./mlClient";

export interface TtsVoice {
  id: string;
  lang: string;
  name: string;
}

export const TTS_VOICES: TtsVoice[] = [
  { id: "Xenova/mms-tts-eng", lang: "en", name: "English" },
  { id: "Xenova/mms-tts-spa", lang: "es", name: "Spanish" },
  { id: "Xenova/mms-tts-fra", lang: "fr", name: "French" },
  { id: "Xenova/mms-tts-deu", lang: "de", name: "German" },
  { id: "Xenova/mms-tts-por", lang: "pt", name: "Portuguese" },
  { id: "Xenova/mms-tts-rus", lang: "ru", name: "Russian" },
  { id: "Xenova/mms-tts-hin", lang: "hi", name: "Hindi" },
  { id: "Xenova/mms-tts-ara", lang: "ar", name: "Arabic" },
  { id: "Xenova/mms-tts-kor", lang: "ko", name: "Korean" },
  { id: "Xenova/mms-tts-vie", lang: "vi", name: "Vietnamese" },
  { id: "Xenova/mms-tts-ron", lang: "ro", name: "Romanian" },
  { id: "Xenova/mms-tts-yor", lang: "yo", name: "Yoruba" },
];

/** 16-bit PCM mono WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let o = 44;
  for (let i = 0; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export interface SynthesisResult {
  blob: Blob;
  duration: number;
  sampleRate: number;
}

export async function synthesizeSpeech(text: string, model: string, onProgress?: (p: MlProgress) => void, signal?: AbortSignal): Promise<SynthesisResult> {
  const out = await mlRequest<{ audio: Float32Array; sampleRate: number }>((id) => ({ type: "tts", id, text, model }), onProgress, signal);
  const samples = out.audio;
  return { blob: encodeWav(samples, out.sampleRate), duration: samples.length / out.sampleRate, sampleRate: out.sampleRate };
}

/** Instant preview with the browser's own voices (not recorded). */
export function previewWithBrowserVoice(text: string, lang: string): boolean {
  if (typeof speechSynthesis === "undefined") return false;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang;
  speechSynthesis.speak(u);
  return true;
}
