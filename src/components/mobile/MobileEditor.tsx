"use client";
/**
 * NoCap Edit · Mobile: the phone-first flow. Pick a video → captions →
 * pick a look → export → "Save Video" into Photos. Four screens, one thumb.
 *
 * Deliberately skips everything the desktop start screen does on import
 * (IndexedDB copy, waveform decode, 160-frame filmstrip, isolation reload):
 * on an iPhone those serialise into minutes. Here the file stays in memory,
 * audio is decoded once for Whisper, and export is WebCodecs (see
 * lib/mobile/exportLite.ts) — no ffmpeg, no SharedArrayBuffer.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, Film, Monitor, Square, X } from "lucide-react";
import "@/lib/fonts"; // registers next/font family names for canvas text on the client
import { cx } from "@/lib/utils/cx";
import { AudioExtractError, extractAudio, isIOS, type AudioStrategy, type SourceAudio } from "@/lib/mobile/audio";
import { hasWebGPU, transcribeSamples } from "@/lib/speech/transcriber";
import { resetMlWorker, type MlProgress } from "@/lib/speech/mlClient";
import { buildCues, CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { cleanWords } from "@/lib/mobile/cleanWords";
import { ensureFontsLoaded } from "@/lib/captions/fonts";
import { defaultSubtitleStyle, type CaptionCue, type SubtitleStyle, type WordTiming } from "@/lib/models/project";
import { checkLiteSupport, exportCaptionedVideo, type LiteExportResult, type LiteProgress, type LiteSupport } from "@/lib/mobile/exportLite";
import { shouldStream } from "@/lib/mobile/exportBudget";
import { friendlyExportError } from "@/lib/export/friendlyError";
import { fastExportCaptionedVideo, type FastExportDebugMode } from "@/lib/mobile/fastExport";
import { acquireWakeLock, saveVideo } from "@/lib/mobile/share";
import { probeVideo } from "@/lib/media/probe";
import { readDisplaySize } from "@/lib/mobile/displaySize";
import { DEFAULT_REFRAME, outputFrame, type Reframe } from "@/lib/mobile/reframe";
import { ExportTimer, type ExportTiming } from "./ExportTimer";
import { ActionBar, SecondaryButton } from "./MobileChrome";
import { PickScreen } from "./PickScreen";
import { ProgressScreen, StatusLine } from "./ProgressScreen";
import { StyleScreen } from "./StyleScreen";
import { DoneScreen } from "./DoneScreen";
import { LONG_SECONDS, MAX_SECONDS, MODEL_ACCURATE, MODEL_FAST, fmtTime, isOutOfMemory, markInflight, noopSubscribe, readInflight, type Step } from "./mobileHelpers";

export function MobileEditor() {
  const [step, setStep] = useState<Step>("pick");
  const [support, setSupport] = useState<LiteSupport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  /** The clip's shown size, from the file (see lib/mobile/displaySize.ts). */
  const [sourceSize, setSourceSize] = useState<{ w: number; h: number } | null>(null);
  const [sourceAudio, setSourceAudio] = useState<SourceAudio | null>(null);
  const [accurate, setAccurate] = useState(true);
  const [status, setStatus] = useState<{ message: string; progress: number | null; detail?: string }>({ message: "", progress: null });
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [words, setWords] = useState<WordTiming[]>([]);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [style, setStyle] = useState<SubtitleStyle>(() => ({ ...defaultSubtitleStyle(), presetId: "hormozi", y: 0.74 }));
  const [wordsPerCue, setWordsPerCue] = useState(3);
  const [reframe, setReframe] = useState<Reframe>(DEFAULT_REFRAME);
  const [result, setResult] = useState<LiteExportResult | null>(null);
  const [saved, setSaved] = useState<"shared" | "downloaded" | null>(null);
  const restartedDuring = useSyncExternalStore(noopSubscribe, readInflight, () => null);
  const [timing, setTiming] = useState<ExportTiming | null>(null); // TEMP: export timer
  const abortRef = useRef<AbortController | null>(null);
  const exportVideoRef = useRef<HTMLVideoElement>(null);
  const exportCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    checkLiteSupport().then((s) => {
      if (alive) setSupport(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Object URLs follow their blobs: created during render (memoised per
  // blob), revoked when the blob changes or the screen unmounts.
  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);
  const resultUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : null), [result]);
  useEffect(() => () => { if (resultUrl) URL.revokeObjectURL(resultUrl); }, [resultUrl]);

  /** Regroups the recognised words into cues (discards manual text edits). */
  const changeWordsPerCue = (n: number) => {
    setWordsPerCue(n);
    if (words.length) setCues(buildCues(words, { ...CAPTION_RULES, maxWords: n }));
  };

  const reset = () => {
    abortRef.current?.abort();
    setStep("pick");
    setFile(null);
    setSourceAudio(null);
    setWords([]);
    setCues([]);
    setReframe(DEFAULT_REFRAME);
    setResult(null);
    setSaved(null);
    setError(null);
    setTiming(null);
  };

  async function analyse(picked: File) {
    setError(null);
    setFile(picked);
    setSaved(null);
    setResult(null);
    setStep("analysing");
    markInflight("reading the video");
    const releaseLock = await acquireWakeLock();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setStatus({ message: "Reading your video", progress: null });
      setSourceSize(null);
      const info = await probeVideo(picked);
      if (controller.signal.aborted) return;
      setDuration(info.duration);
      setSourceSize(await readDisplaySize(picked));
      if (controller.signal.aborted) return;
      if (info.duration > MAX_SECONDS) {
        throw new Error(`This clip is ${fmtTime(info.duration)} long. On a phone, keep it under 15 minutes — trim it in Photos first.`);
      }
      // `?audio=ffmpeg` forces the iOS fallback path, for testing it elsewhere.
      const audioParam = new URLSearchParams(window.location.search).get("audio");
      const strategy: AudioStrategy = audioParam === "ffmpeg" || audioParam === "webcodecs" || audioParam === "webaudio" ? audioParam : "auto";
      const decoded = await extractAudio(picked, {
        strategy,
        onStatus: (m) => {
          markInflight(m.toLowerCase());
          setStatus({ message: m, progress: null });
        },
      });
      if (controller.signal.aborted) return;
      setSourceAudio(decoded);
      markInflight("loading the speech model");

      // iOS Safari: WebGPU + onnxruntime and multi-threaded wasm both get
      // the tab killed while the model loads; single-threaded wasm is the
      // configuration that survives. `?asr=webgpu|wasm` / `?threads=N`
      // override it for experiments.
      const params = new URLSearchParams(window.location.search);
      const asrParam = params.get("asr");
      const threadsParam = Number(params.get("threads"));
      let device: "webgpu" | "wasm";
      if (asrParam === "webgpu" || asrParam === "wasm") device = asrParam;
      else if (isIOS()) device = "wasm";
      else device = (await hasWebGPU()) ? "webgpu" : "wasm";
      const threads = Number.isFinite(threadsParam) && threadsParam > 0 ? threadsParam : isIOS() ? 1 : undefined;
      const model = accurate ? MODEL_ACCURATE : MODEL_FAST;
      const engineLabel = device === "webgpu" ? "GPU accelerated" : `CPU mode${threads ? ` · ${threads} thread${threads === 1 ? "" : "s"}` : ""}`;
      markInflight(`loading the speech model (${device}${threads ? `, ${threads} thread` : ""})`);
      setStatus({ message: "Loading Whisper", progress: null, detail: engineLabel });
      const onProgress = (p: MlProgress) => {
        const downloading = /download|fetch|load/i.test(p.stage) || /download/i.test(p.message);
        markInflight(downloading ? `downloading the speech model (${device})` : `transcribing (${device}${threads ? `, ${threads} thread` : ""})`);
        setStatus({
          message: downloading ? "Downloading speech model (one time)" : p.partialText ? "Listening…" : p.message || "Transcribing",
          progress: p.progress,
        });
      };
      const transcribeOpts = { model, language: "auto", device, threads, repetitionPenalty: 1.2, onProgress, signal: controller.signal };
      let res;
      try {
        res = await transcribeSamples(decoded.speech, transcribeOpts);
      } catch (e) {
        // iOS: the model's wasm heap can fail to allocate in a tab whose
        // process still holds an earlier run's memory. A fresh worker, a
        // moment later, usually gets it.
        if (!isOutOfMemory(e) || controller.signal.aborted) throw e;
        console.warn("[nocap mobile] speech model out of memory, retrying with a fresh worker");
        resetMlWorker("retry");
        setStatus({ message: "Freeing memory, trying again", progress: null });
        await new Promise((r) => setTimeout(r, 1500));
        if (controller.signal.aborted) return;
        res = await transcribeSamples(decoded.speech, transcribeOpts);
      }
      if (controller.signal.aborted) return;
      const cleaned = cleanWords(res.words);
      if (cleaned.length === 0) throw new Error("Couldn't hear any speech in this video.");
      await ensureFontsLoaded();
      setWords(cleaned);
      setCues(buildCues(cleaned, { ...CAPTION_RULES, maxWords: wordsPerCue }));
      setStep("style");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("[nocap mobile] analyse failed", e);
      if (e instanceof AudioExtractError) {
        setError({ message: "Couldn't read the audio from this video.", detail: e.message });
      } else if (isOutOfMemory(e)) {
        setError({
          message: "Safari ran out of memory loading the speech model.",
          detail: "Close this tab (and a few others), open the page in a new tab and try again.",
        });
      } else {
        setError({ message: friendlyExportError(e), detail: e instanceof Error && e.name !== "Error" ? e.name : undefined });
      }
      setStep("pick");
    } finally {
      markInflight(null);
      releaseLock();
    }
  }

  async function runExport() {
    if (!file || !exportVideoRef.current || !exportCanvasRef.current) return;
    setError(null);
    setStep("exporting");
    markInflight("exporting");
    setStatus({ message: "Preparing", progress: null });
    // TEMP: export timer — the clock starts on the tap.
    const startedAt = performance.now();
    let lastStage = "Preparing";
    setTiming({ startedAt, endedAt: null, marks: [{ label: lastStage, at: startedAt }], outcome: "running", engine: null, clipSeconds: duration });
    const mark = (label: string) => {
      if (label === lastStage) return;
      lastStage = label;
      const at = performance.now();
      setTiming((t) => (t ? { ...t, marks: [...t.marks, { label, at }] } : t));
    };
    const finishTiming = (outcome: ExportTiming["outcome"], done: LiteExportResult | null) => {
      const at = performance.now();
      setTiming((t) =>
        t ? { ...t, endedAt: at, outcome, engine: done?.engine ?? null, output: done ? `${done.width}×${done.height}` : undefined, stats: done?.stats } : t,
      );
    };
    const releaseLock = await acquireWakeLock();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const params = new URLSearchParams(window.location.search);
      // Long clips always stream; shorter ones stream when the MP4 is likely
      // to pass ~64 MB, so the heap never holds a large output. Short clips
      // keep the in-memory fast-start path exactly as before.
      const outSize = sourceSize ? outputFrame(sourceSize.w, sourceSize.h, reframe) : null;
      const streaming = duration > LONG_SECONDS || params.get("stream") === "1" || (outSize !== null && shouldStream(duration, outSize.width, outSize.height));
      const engine = params.get("export"); // "fast" | "realtime" force one path (testing)
      // The fast exporter reports every frame; re-rendering the screen 30×
      // a second on a phone is wasted work, so the bar updates ~4× a second.
      let lastStatusAt = 0;
      let lastMessage = "";
      const onProgress = (p: LiteProgress) => {
        mark(p.message);
        const now = performance.now();
        if (p.message === lastMessage && now - lastStatusAt < 250 && p.progress !== null && p.progress < 1) return;
        lastStatusAt = now;
        lastMessage = p.message;
        setStatus({ message: p.message, progress: p.progress });
      };
      let out: LiteExportResult | null = null;

      // Fast path: decode the file directly and render many times faster
      // than real time. Anything it can't handle falls back to playing
      // the clip through once and capturing it.
      if (engine !== "realtime") {
        try {
          out = await fastExportCaptionedVideo({
            file,
            streaming,
            reframe,
            cues,
            style,
            canvas: exportCanvasRef.current,
            signal: controller.signal,
            onProgress,
            debugMode: (["passthrough", "nocaptions", "resize-only", "gl", "2d", "rgba"] as FastExportDebugMode[]).find((m) => m === params.get("fx")),
          });
        } catch (e) {
          if (controller.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
          if (engine === "fast") throw e;
          console.warn("[nocap mobile] fast export unavailable, using real-time export", e);
          mark(`Fallback to real-time (${e instanceof Error ? e.message.slice(0, 60) : "error"})`);
          setStatus({ message: "Switching to compatibility export", progress: null });
        }
      }
      if (!out) {
        out = await exportCaptionedVideo({
          file,
          audio: sourceAudio?.channels ? { sampleRate: sourceAudio.sampleRate, channels: sourceAudio.channels } : undefined,
          streaming,
          reframe,
          cues,
          style,
          video: exportVideoRef.current,
          canvas: exportCanvasRef.current,
          signal: controller.signal,
          onProgress,
        });
      }
      finishTiming("done", out);
      setResult(out);
      setStep("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        finishTiming("stopped", null);
        setStep("style");
        return;
      }
      console.error("[nocap mobile] export failed", e);
      finishTiming("failed", null);
      setError({ message: friendlyExportError(e) });
      setStep("style");
    } finally {
      markInflight(null);
      releaseLock();
    }
  }

  async function save() {
    if (!result || !file) return;
    const name = `${file.name.replace(/\.[^.]+$/, "")}-captioned.mp4`;
    setSaved(await saveVideo(result.blob, name));
  }

  const stepIndex = step === "pick" ? 0 : step === "analysing" || step === "style" ? 1 : 2;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-[11px] bg-gradient-to-br from-brand-400 to-sys-indigo text-white shadow-lg shadow-brand-500/30">
            <Film size={18} />
          </span>
          <div className="leading-tight">
            <p className="text-[16px] font-semibold tracking-tight">NoCap Edit</p>
            <p className="text-[11px] text-label-2">On-device captions</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Step dots: Pick · Style · Save */}
          <div className="flex items-center gap-1.5" aria-label={`Step ${stepIndex + 1} of 3`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className={cx("h-1.5 rounded-full transition-all", i === stepIndex ? "w-5 bg-white" : i < stepIndex ? "w-1.5 bg-white/60" : "w-1.5 bg-white/20")} />
            ))}
          </div>
          {step !== "pick" ? (
            <button type="button" onClick={reset} className="ml-1 flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-label-2 active:bg-white/15" aria-label="Start over">
              <X size={16} />
            </button>
          ) : (
            <Link href="/" className="ml-1 flex h-9 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-[12px] text-label-2">
              <Monitor size={13} /> Desktop
            </Link>
          )}
        </div>
      </header>

      {timing && <ExportTimer timing={timing} />}

      <main className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-sys-red/30 bg-sys-red/10 p-3 text-[14px] text-sys-red">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p>{error.message}</p>
              {error.detail && <p className="mt-1 break-words text-[11px] leading-snug text-sys-red/80">{error.detail}</p>}
            </div>
          </div>
        )}

        {step === "pick" && restartedDuring && !error && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-sys-orange/30 bg-sys-orange/10 p-3 text-[14px] text-sys-orange">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <p>Safari restarted the page while {restartedDuring}.</p>
              <p className="mt-1 text-[11px] leading-snug text-sys-orange/80">
                That usually means the clip was too big for the phone&rsquo;s memory. Try a shorter clip (under a minute or two), or trim it in Photos first.
              </p>
            </div>
          </div>
        )}
        {step === "pick" && (
          <PickScreen support={support} accurate={accurate} onAccurate={setAccurate} onPick={analyse} />
        )}

        {step === "analysing" && (
          <ProgressScreen
            title="Making captions"
            status={status}
            note={
              duration > LONG_SECONDS
                ? `Long clip (${fmtTime(duration)}) — captions can take a few minutes on a phone. Keep this screen open.`
                : "Keep this screen open. The speech model downloads once and is cached on your phone."
            }
            onCancel={reset}
          />
        )}

        {step === "style" && fileUrl && (
          <StyleScreen
            fileUrl={fileUrl}
            cues={cues}
            setCues={setCues}
            style={style}
            setStyle={setStyle}
            wordsPerCue={wordsPerCue}
            setWordsPerCue={changeWordsPerCue}
            reframe={reframe}
            setReframe={setReframe}
            sourceSize={sourceSize}
            onExport={runExport}
          />
        )}

        {/* The export surface: always mounted so refs exist, shown while exporting. */}
        <div className={cx("flex flex-1 flex-col", step === "exporting" ? "" : "hidden")}>
          <div className="relative overflow-hidden rounded-3xl bg-[#101012] shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <canvas ref={exportCanvasRef} className="block max-h-[62dvh] w-full object-contain" />
            <video ref={exportVideoRef} muted playsInline className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-[0.01]" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-10">
              <StatusLine status={status} />
            </div>
          </div>
          <p className="mt-3 text-center text-[12px] text-label-2">Rendering on your phone. Keep the app open until it finishes.</p>
          <div className="flex-1" />
          <ActionBar>
            <SecondaryButton className="w-full" onClick={() => abortRef.current?.abort()}>
              <Square size={14} /> Stop
            </SecondaryButton>
          </ActionBar>
        </div>

        {step === "done" && result && resultUrl && (
          <DoneScreen
            result={result}
            resultUrl={resultUrl}
            saved={saved}
            onSave={save}
            onEdit={() => setStep("style")}
            onNew={reset}
          />
        )}
      </main>
    </div>
  );
}
