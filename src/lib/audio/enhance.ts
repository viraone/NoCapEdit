/**
 * Background-noise removal, entirely inside ffmpeg.wasm:
 *  - "rnnoise": the arnndn filter (RNNoise recurrent network, model shipped
 *    in /models/sh.rnnn) — best for speech
 *  - "fft": afftdn spectral denoiser — good for hiss and constant hum
 *  - "both": arnndn followed by afftdn
 * The result is a 48 kHz stereo WAV used as the clip's replacement audio.
 */
import { ffmpegEngine, FFmpegHungError } from "@/lib/ffmpegEngine";

export type EnhanceMode = "rnnoise" | "fft" | "both";

export const ENHANCE_MODES: { id: EnhanceMode; label: string; note: string }[] = [
  { id: "rnnoise", label: "Voice clean-up (RNNoise)", note: "Neural noise suppression tuned for speech" },
  { id: "fft", label: "Hiss & hum (spectral)", note: "afftdn spectral gate for steady background noise" },
  { id: "both", label: "Both", note: "RNNoise then spectral denoise" },
];

export interface EnhanceOptions {
  mode: EnhanceMode;
  /** 0..1 strength for the RNNoise mix. */
  strength?: number;
  onProgress?: (message: string, progress: number | null) => void;
  signal?: AbortSignal;
}

export async function enhanceAudio(blob: Blob, opts: EnhanceOptions): Promise<{ blob: Blob; filter: string }> {
  try {
    return await runEnhance(blob, opts);
  } catch (e) {
    if (!(e instanceof FFmpegHungError) || ffmpegEngine.preferSingleThread) throw e;
    ffmpegEngine.preferSingleThread = true;
    ffmpegEngine.cancel();
    return runEnhance(blob, opts);
  }
}

async function runEnhance(blob: Blob, opts: EnhanceOptions): Promise<{ blob: Blob; filter: string }> {
  const engine = ffmpegEngine;
  opts.onProgress?.("Loading audio engine", null);
  await engine.load((m) => opts.onProgress?.(m, null));
  const ffmpeg = engine.instance;
  const mounted = await engine.mountInputs([{ name: "src.bin", blob }]);
  const temp: string[] = [];
  try {
    const src = mounted.inputPath("src.bin");
    const info = await engine.probe(src);
    if (!info.audio) throw new Error("This clip has no audio track.");
    const filters: string[] = [];
    if (opts.mode === "rnnoise" || opts.mode === "both") {
      const res = await fetch("/models/sh.rnnn");
      if (!res.ok) throw new Error("The RNNoise model could not be loaded.");
      await ffmpeg.writeFile("/sh.rnnn", new Uint8Array(await res.arrayBuffer()));
      temp.push("/sh.rnnn");
      filters.push(`arnndn=m=/sh.rnnn:mix=${Math.max(0, Math.min(1, opts.strength ?? 0.9)).toFixed(2)}`);
    }
    if (opts.mode === "fft" || opts.mode === "both") filters.push("afftdn=nf=-25:nr=12:tn=1");
    const filter = filters.join(",");
    const out = "clean.wav";
    temp.push(out);
    opts.onProgress?.("Removing noise", 0);
    const onAbort = () => engine.cancel();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const code = await engine.exec(["-hide_banner", "-y", "-i", src, "-vn", "-af", filter, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", out], (t) =>
      opts.onProgress?.(`Removing noise ${Math.round(Math.min(1, t / Math.max(0.1, info.duration)) * 100)}%`, Math.min(1, t / Math.max(0.1, info.duration))),
    );
    opts.signal?.removeEventListener("abort", onAbort);
    if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (code !== 0) throw new Error(`Noise removal failed.\n${engine.recentLogs()}`);
    const data = (await ffmpeg.readFile(out)) as Uint8Array;
    return { blob: new Blob([data as BlobPart], { type: "audio/wav" }), filter };
  } finally {
    if (!opts.signal?.aborted) {
      for (const t of temp) await ffmpeg.deleteFile(t).catch(() => undefined);
      await mounted.release();
    }
  }
}
