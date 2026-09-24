/**
 * Web Worker that runs Whisper (speech-to-text with word timestamps) and
 * Marian (translation) models with Transformers.js. Models are downloaded
 * once from the Hugging Face Hub and cached by the browser; inference runs on
 * WebGPU when available, otherwise on WASM. Nothing leaves the device.
 */
import { pipeline, env, WhisperTextStreamer, AutoProcessor, AutoModel, AutoModelForAudioFrameClassification, RawImage } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;

type Device = "webgpu" | "wasm";

export type MlRequest =
  | {
      type: "transcribe";
      id: number;
      audio: Float32Array;
      model: string;
      language: string;
      device: "auto" | Device;
    }
  | { type: "translate"; id: number; texts: string[]; steps: { model: string; prefix?: string }[] }
  | { type: "diarize"; id: number; audio: Float32Array; maxSpeakers: number }
  | { type: "tts"; id: number; text: string; model: string }
  | { type: "matte"; id: number; image: Blob }
  | { type: "dispose"; id: number };

export type MlResponse =
  | { type: "progress"; id: number; stage: string; message: string; progress: number | null; partialText?: string }
  | { type: "result"; id: number; payload: unknown }
  | { type: "error"; id: number; message: string };

interface WordOut {
  text: string;
  start: number;
  end: number;
}

type AsrChunk = { text: string; timestamp: [number, number | null] };
type AsrPipe = ((audio: Float32Array, opts: Record<string, unknown>) => Promise<{ text: string; chunks?: AsrChunk[] }>) & {
  dispose: () => Promise<void>;
  tokenizer: unknown;
  processor: { feature_extractor: { config: { chunk_length: number } } };
  model: { config: { max_source_positions: number } };
};
type TranslatePipe = ((texts: string[], opts: Record<string, unknown>) => Promise<{ translation_text: string }[]>) & {
  dispose: () => Promise<void>;
};

interface WorkerScope {
  postMessage(msg: MlResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<MlRequest>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (msg: MlResponse) => scope.postMessage(msg);

let asr: { key: string; pipe: AsrPipe } | null = null;
const translators = new Map<string, TranslatePipe>();

async function detectDevice(pref: "auto" | Device): Promise<Device> {
  if (pref === "wasm") return "wasm";
  const gpu = (navigator as unknown as { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    const adapter = await gpu.requestAdapter();
    return adapter ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

function downloadProgress(id: number, stage: string) {
  const seen = new Map<string, number>();
  return (p: { status?: string; file?: string; progress?: number; loaded?: number; total?: number }) => {
    if (p.status === "progress" && p.file) {
      seen.set(p.file, p.progress ?? 0);
      const files = [...seen.values()];
      const avg = files.reduce((a, b) => a + b, 0) / files.length / 100;
      const mb = p.total ? ` (${Math.round((p.total / 1_048_576) * 10) / 10} MB)` : "";
      post({ type: "progress", id, stage, message: `Downloading ${p.file}${mb}`, progress: avg });
    } else if (p.status === "ready") {
      post({ type: "progress", id, stage, message: "Model ready", progress: 1 });
    } else if (p.status === "initiate" && p.file) {
      post({ type: "progress", id, stage, message: `Fetching ${p.file}`, progress: null });
    }
  };
}

async function getAsr(model: string, device: Device, id: number): Promise<AsrPipe> {
  const key = `${model}|${device}`;
  if (asr?.key === key) return asr.pipe;
  if (asr) {
    await asr.pipe.dispose().catch(() => undefined);
    asr = null;
  }
  post({ type: "progress", id, stage: "load", message: `Loading ${model.split("/").pop()} on ${device}`, progress: null });
  const dtype = device === "webgpu" ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8";
  const pipe = (await pipeline("automatic-speech-recognition", model, {
    device,
    dtype: dtype as never,
    progress_callback: downloadProgress(id, "download"),
  })) as unknown as AsrPipe;
  asr = { key, pipe };
  return pipe;
}

async function transcribe(req: Extract<MlRequest, { type: "transcribe" }>) {
  const device = await detectDevice(req.device);
  const pipe = await getAsr(req.model, device, req.id);
  const totalSeconds = req.audio.length / 16000;

  let streamer: WhisperTextStreamer | undefined;
  try {
    const timePrecision = pipe.processor.feature_extractor.config.chunk_length / pipe.model.config.max_source_positions;
    let partial = "";
    streamer = new WhisperTextStreamer(pipe.tokenizer as never, {
      skip_prompt: true,
      time_precision: timePrecision,
      on_chunk_start: (x: number) => {
        post({
          type: "progress",
          id: req.id,
          stage: "transcribe",
          message: `Transcribing ${Math.round(x)}s / ${Math.round(totalSeconds)}s`,
          progress: totalSeconds ? Math.min(0.99, x / totalSeconds) : null,
          partialText: partial,
        });
      },
      callback_function: (text: string) => {
        partial += text;
        post({ type: "progress", id: req.id, stage: "transcribe", message: "Transcribing", progress: null, partialText: partial });
      },
    });
  } catch {
    streamer = undefined;
  }

  post({ type: "progress", id: req.id, stage: "transcribe", message: "Transcribing", progress: 0 });
  const options: Record<string, unknown> = {
    return_timestamps: "word",
    chunk_length_s: 30,
    stride_length_s: 5,
    task: "transcribe",
  };
  if (req.language && req.language !== "auto") options.language = req.language;
  if (streamer) options.streamer = streamer;

  const out = await pipe(req.audio, options);
  const chunks = out.chunks ?? [];
  const words: WordOut[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const text = (c.text ?? "").trim();
    if (!text) continue;
    const start = Number(c.timestamp?.[0] ?? (words.length ? words[words.length - 1].end : 0));
    let end = c.timestamp?.[1];
    if (end === null || end === undefined || !Number.isFinite(end)) {
      const next = chunks[i + 1]?.timestamp?.[0];
      end = typeof next === "number" ? next : start + 0.4;
    }
    words.push({ text, start, end: Math.max(Number(end), start + 0.05) });
  }
  post({ type: "result", id: req.id, payload: { words, text: out.text ?? words.map((w) => w.text).join(" "), device } });
}

async function getTranslator(model: string, id: number): Promise<TranslatePipe> {
  const cached = translators.get(model);
  if (cached) return cached;
  post({ type: "progress", id, stage: "load", message: `Loading ${model.split("/").pop()}`, progress: null });
  const pipe = (await pipeline("translation", model, {
    device: "wasm",
    dtype: "q8",
    progress_callback: downloadProgress(id, "download"),
  })) as unknown as TranslatePipe;
  translators.set(model, pipe);
  return pipe;
}

async function translate(req: Extract<MlRequest, { type: "translate" }>) {
  let texts = req.texts;
  const batchSize = 8;
  for (const [stepIndex, step] of req.steps.entries()) {
    const pipe = await getTranslator(step.model, req.id);
    const out: string[] = new Array(texts.length).fill("");
    const indices = texts.map((t, i) => (t.trim() ? i : -1)).filter((i) => i >= 0);
    for (let b = 0; b < indices.length; b += batchSize) {
      const batch = indices.slice(b, b + batchSize);
      const inputs = batch.map((i) => (step.prefix ? `${step.prefix} ${texts[i]}` : texts[i]));
      const results = await pipe(inputs, { max_new_tokens: 256 });
      results.forEach((r, k) => {
        out[batch[k]] = (r.translation_text ?? "").trim();
      });
      post({
        type: "progress",
        id: req.id,
        stage: "translate",
        message: `Translating ${Math.min(indices.length, b + batch.length)} / ${indices.length}${req.steps.length > 1 ? ` (step ${stepIndex + 1}/${req.steps.length})` : ""}`,
        progress: (stepIndex + (b + batch.length) / Math.max(1, indices.length)) / req.steps.length,
      });
    }
    texts = out;
  }
  post({ type: "result", id: req.id, payload: { translations: texts } });
}

// ---------------------------------------------------------------------------
// Speaker diarization: pyannote segmentation (who speaks when, locally per
// window) + WeSpeaker embeddings clustered into global speaker identities.
// ---------------------------------------------------------------------------

const SEG_MODEL = "onnx-community/pyannote-segmentation-3.0";
const EMB_MODEL = "onnx-community/wespeaker-voxceleb-resnet34-LM";
const SAMPLE_RATE = 16000;

interface Turn {
  start: number;
  end: number;
  localId: number;
  window: number;
}
interface DiarizeSegment {
  start: number;
  end: number;
  speaker: number;
}

type SegProcessor = ((audio: Float32Array) => Promise<Record<string, unknown>>) & {
  post_process_speaker_diarization?: (logits: unknown, numSamples: number) => { id: number; start: number; end: number; confidence: number }[][];
  feature_extractor?: { post_process_speaker_diarization?: (logits: unknown, numSamples: number) => { id: number; start: number; end: number; confidence: number }[][] };
};
type Model = ((inputs: Record<string, unknown>) => Promise<Record<string, { data: Float32Array; dims: number[] }>>) & { dispose?: () => Promise<void> };

let segModels: { processor: SegProcessor; model: Model } | null = null;
let embModels: { processor: (audio: Float32Array) => Promise<Record<string, unknown>>; model: Model } | null = null;

function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Average-linkage agglomerative clustering on cosine distance. */
function cluster(embeddings: Float32Array[], threshold: number, maxClusters: number): number[] {
  const n = embeddings.length;
  let clusters: number[][] = embeddings.map((_, i) => [i]);
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += cosineDistance(embeddings[i], embeddings[j]);
    return s / (a.length * b.length);
  };
  while (clusters.length > 1) {
    let best = { d: Infinity, a: -1, b: -1 };
    for (let a = 0; a < clusters.length; a++)
      for (let b = a + 1; b < clusters.length; b++) {
        const d = dist(clusters[a], clusters[b]);
        if (d < best.d) best = { d, a, b };
      }
    if (best.d > threshold && clusters.length <= maxClusters) break;
    const merged = [...clusters[best.a], ...clusters[best.b]];
    clusters = clusters.filter((_, i) => i !== best.a && i !== best.b);
    clusters.push(merged);
  }
  // Order speakers by first appearance.
  clusters.sort((a, b) => Math.min(...a) - Math.min(...b));
  const labels = new Array<number>(n).fill(0);
  clusters.forEach((c, label) => c.forEach((i) => (labels[i] = label)));
  return labels;
}

async function diarize(req: Extract<MlRequest, { type: "diarize" }>) {
  const progress = downloadProgress(req.id, "download");
  if (!segModels) {
    post({ type: "progress", id: req.id, stage: "load", message: "Loading speaker segmentation model", progress: null });
    const processor = (await AutoProcessor.from_pretrained(SEG_MODEL, { progress_callback: progress })) as unknown as SegProcessor;
    const model = (await AutoModelForAudioFrameClassification.from_pretrained(SEG_MODEL, { device: "wasm", dtype: "fp32", progress_callback: progress })) as unknown as Model;
    segModels = { processor, model };
  }
  const postProcess = segModels.processor.post_process_speaker_diarization ?? segModels.processor.feature_extractor?.post_process_speaker_diarization;
  if (!postProcess) throw new Error("Speaker segmentation post-processing is unavailable in this Transformers.js build.");

  const windowSamples = SAMPLE_RATE * 30;
  const turns: Turn[] = [];
  const total = req.audio.length;
  for (let off = 0, w = 0; off < total; off += windowSamples, w++) {
    const slice = req.audio.subarray(off, Math.min(total, off + windowSamples));
    if (slice.length < SAMPLE_RATE * 0.5) break;
    post({ type: "progress", id: req.id, stage: "diarize", message: `Finding speaker turns ${Math.round(off / SAMPLE_RATE)}s / ${Math.round(total / SAMPLE_RATE)}s`, progress: (off / total) * 0.6 });
    const inputs = await segModels.processor(slice);
    const { logits } = await segModels.model(inputs);
    const result = postProcess.call(segModels.processor, logits, slice.length);
    const list = Array.isArray(result[0]) ? result[0] : (result as unknown as { id: number; start: number; end: number }[]);
    for (const t of list) turns.push({ start: t.start + off / SAMPLE_RATE, end: t.end + off / SAMPLE_RATE, localId: t.id, window: w });
  }
  // Merge consecutive turns of the same local speaker inside a window.
  turns.sort((a, b) => a.start - b.start);
  const merged: Turn[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.window === t.window && last.localId === t.localId && t.start - last.end < 0.4) last.end = Math.max(last.end, t.end);
    else merged.push({ ...t });
  }
  const usable = merged.filter((t) => t.end - t.start >= 0.4);
  if (!usable.length) {
    post({ type: "result", id: req.id, payload: { segments: [], speakers: 0 } });
    return;
  }

  if (!embModels) {
    post({ type: "progress", id: req.id, stage: "load", message: "Loading speaker embedding model", progress: null });
    const processor = (await AutoProcessor.from_pretrained(EMB_MODEL, { progress_callback: progress })) as unknown as (audio: Float32Array) => Promise<Record<string, unknown>>;
    const model = (await AutoModel.from_pretrained(EMB_MODEL, { device: "wasm", dtype: "fp32", progress_callback: progress })) as unknown as Model;
    embModels = { processor, model };
  }
  const embeddings: Float32Array[] = [];
  for (const [i, t] of usable.entries()) {
    post({ type: "progress", id: req.id, stage: "diarize", message: `Identifying speakers ${i + 1} / ${usable.length}`, progress: 0.6 + (i / usable.length) * 0.4 });
    const slice = req.audio.subarray(Math.floor(t.start * SAMPLE_RATE), Math.floor(t.end * SAMPLE_RATE));
    const inputs = await embModels.processor(slice);
    const out = await embModels.model(inputs);
    const tensor = out.embeddings ?? out.last_hidden_state ?? Object.values(out)[0];
    embeddings.push(new Float32Array(tensor.data));
  }
  const labels = cluster(embeddings, 0.62, Math.max(1, req.maxSpeakers));
  const segments: DiarizeSegment[] = usable.map((t, i) => ({ start: t.start, end: t.end, speaker: labels[i] }));
  segments.sort((a, b) => a.start - b.start);
  const compact: DiarizeSegment[] = [];
  for (const s of segments) {
    const last = compact[compact.length - 1];
    if (last && last.speaker === s.speaker && s.start - last.end < 0.6) last.end = Math.max(last.end, s.end);
    else compact.push({ ...s });
  }
  post({ type: "result", id: req.id, payload: { segments: compact, speakers: new Set(labels).size } });
}

// ---------------------------------------------------------------------------
// Text-to-speech (MMS-TTS / VITS) for offline voice-overs.
// ---------------------------------------------------------------------------

type TtsPipe = ((text: string) => Promise<{ audio: Float32Array; sampling_rate: number }>) & { dispose: () => Promise<void> };
const ttsCache = new Map<string, TtsPipe>();

async function tts(req: Extract<MlRequest, { type: "tts" }>) {
  let pipe = ttsCache.get(req.model);
  if (!pipe) {
    post({ type: "progress", id: req.id, stage: "load", message: `Loading voice ${req.model.split("/").pop()}`, progress: null });
    pipe = (await pipeline("text-to-speech", req.model, { device: "wasm", dtype: "q8", progress_callback: downloadProgress(req.id, "download") })) as unknown as TtsPipe;
    ttsCache.set(req.model, pipe);
  }
  post({ type: "progress", id: req.id, stage: "tts", message: "Synthesising speech", progress: null });
  const out = await pipe(req.text);
  const audio = new Float32Array(out.audio);
  scope.postMessage({ type: "result", id: req.id, payload: { audio, sampleRate: out.sampling_rate } }, [audio.buffer]);
}

// ---------------------------------------------------------------------------
// Background removal (RMBG-1.4) → alpha mask.
// ---------------------------------------------------------------------------

type MattePipe = ((img: unknown) => Promise<Array<{ data: Uint8Array; width: number; height: number; channels: number }>>) & { dispose: () => Promise<void> };
let mattePipe: MattePipe | null = null;

async function matte(req: Extract<MlRequest, { type: "matte" }>) {
  if (!mattePipe) {
    const device = await detectDevice("auto");
    post({ type: "progress", id: req.id, stage: "load", message: `Loading background-removal model on ${device}`, progress: null });
    mattePipe = (await pipeline("background-removal", "briaai/RMBG-1.4", { device, dtype: device === "webgpu" ? "fp32" : "q8", progress_callback: downloadProgress(req.id, "download") } as never)) as unknown as MattePipe;
  }
  const image = await RawImage.fromBlob(req.image);
  const [out] = await mattePipe(image);
  const { width, height, channels, data } = out;
  const alpha = new Uint8Array(width * height);
  if (channels === 4) for (let i = 0, j = 3; i < alpha.length; i++, j += 4) alpha[i] = data[j];
  else if (channels === 1) alpha.set(data.subarray(0, alpha.length));
  else for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * channels];
  scope.postMessage({ type: "result", id: req.id, payload: { alpha, width, height } }, [alpha.buffer]);
}

scope.onmessage = async (event: MessageEvent<MlRequest>) => {
  const req = event.data;
  try {
    if (req.type === "transcribe") await transcribe(req);
    else if (req.type === "translate") await translate(req);
    else if (req.type === "diarize") await diarize(req);
    else if (req.type === "tts") await tts(req);
    else if (req.type === "matte") await matte(req);
    else if (req.type === "dispose") {
      if (asr) await asr.pipe.dispose().catch(() => undefined);
      asr = null;
      for (const t of translators.values()) await t.dispose().catch(() => undefined);
      translators.clear();
      post({ type: "result", id: req.id, payload: null });
    }
  } catch (error) {
    post({ type: "error", id: req.id, message: error instanceof Error ? error.message : String(error) });
  }
};
