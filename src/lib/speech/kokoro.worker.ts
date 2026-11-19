/**
 * Web Worker for the Kokoro voice (an 82M-parameter model that sounds far more natural than the
 * small per-language voices). It is kept apart from the ML worker so its model and phonemizer load only
 * when a narrator that needs them is chosen. The model comes from the Hugging Face Hub once and is
 * cached by the browser; speech is made on this device.
 */
import { KokoroTTS } from "kokoro-js";

export type KokoroRequest = { type: "speak"; id: number; text: string; voice: string };
export type KokoroResponse =
  | { type: "progress"; id: number; message: string; progress: number | null }
  | { type: "result"; id: number; audio: Float32Array; sampleRate: number }
  | { type: "error"; id: number; message: string };

const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";
const scope = self as unknown as { onmessage: ((e: MessageEvent<KokoroRequest>) => void) | null; postMessage: (m: KokoroResponse, t?: Transferable[]) => void };
let loading: Promise<KokoroTTS> | null = null;

function load(id: number): Promise<KokoroTTS> {
  loading ??= KokoroTTS.from_pretrained(MODEL, {
    dtype: "q8",
    device: "wasm",
    progress_callback: (p: { status?: string; progress?: number }) => {
      if (p.status === "progress" && typeof p.progress === "number") scope.postMessage({ type: "progress", id, message: "Downloading the narrator voice", progress: p.progress / 100 });
    },
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

scope.onmessage = async (event) => {
  const req = event.data;
  try {
    const tts = await load(req.id);
    scope.postMessage({ type: "progress", id: req.id, message: "Recording the narrator", progress: null });
    const out = await tts.generate(req.text, { voice: req.voice as never });
    const audio = new Float32Array(out.audio);
    scope.postMessage({ type: "result", id: req.id, audio, sampleRate: out.sampling_rate }, [audio.buffer]);
  } catch (e) {
    scope.postMessage({ type: "error", id: req.id, message: e instanceof Error ? e.message : String(e) });
  }
};
