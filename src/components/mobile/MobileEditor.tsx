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
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  ChevronUp,
  Crop,
  Download,
  Film,
  Loader2,
  Minus,
  Monitor,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Sparkles,
  Square,
  Type,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import "@/lib/fonts"; // registers next/font family names for canvas text on the client
import { cx } from "@/lib/utils/cx";
import { AudioExtractError, extractAudio, isIOS, type AudioStrategy, type SourceAudio } from "@/lib/mobile/audio";
import { hasWebGPU, transcribeSamples, WHISPER_MODELS } from "@/lib/speech/transcriber";
import type { MlProgress } from "@/lib/speech/mlClient";
import { buildCues, CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { cleanWords } from "@/lib/mobile/cleanWords";
import { CAPTION_PRESETS, getPreset } from "@/lib/captions/presets";
import { drawCue } from "@/lib/captions/renderer";
import { ensureFontsLoaded, fontFamily } from "@/lib/captions/fonts";
import { defaultSubtitleStyle, type CaptionCue, type SubtitleStyle, type WordTiming } from "@/lib/models/project";
import { checkLiteSupport, exportCaptionedVideo, type ExportStats, type LiteExportResult, type LiteProgress, type LiteSupport } from "@/lib/mobile/exportLite";
import { fastExportCaptionedVideo, type FastExportDebugMode } from "@/lib/mobile/fastExport";
import { acquireWakeLock, canShareFiles, saveVideo } from "@/lib/mobile/share";
import { probeVideo } from "@/lib/media/probe";
import { aspectOf, cropRect, DEFAULT_REFRAME, FRAME_FORMATS, MAX_ZOOM, outputFrame, panBy, withZoom, type Reframe } from "@/lib/mobile/reframe";

type Step = "pick" | "analysing" | "style" | "exporting" | "done";

/** sessionStorage key holding the stage in progress. If it is still set
 * when the page loads, Safari restarted the tab mid-way (its silent
 * out-of-memory recovery) and the pick screen says so. */
const INFLIGHT_KEY = "nocap.mobile.inflight";
const noopSubscribe = () => () => {};
function readInflight(): string | null {
  try {
    return window.sessionStorage.getItem(INFLIGHT_KEY);
  } catch {
    return null;
  }
}
function markInflight(stage: string | null) {
  try {
    if (stage) window.sessionStorage.setItem(INFLIGHT_KEY, stage);
    else window.sessionStorage.removeItem(INFLIGHT_KEY);
  } catch {
    /* storage blocked: the notice is a nicety */
  }
}
/** iPhone Safari tab (not yet on the Home Screen) → worth a one-line tip. */
function readHomeScreenTip(): boolean {
  if (!isIOS()) return false;
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone || window.matchMedia("(display-mode: standalone)").matches;
  return !standalone;
}

/** Beyond this the phone can't realistically hold the audio + captions. */
const MAX_SECONDS = 15 * 60;
/** From here on the export streams to Blob storage instead of memory. */
const LONG_SECONDS = 120;

const MODEL_FAST = WHISPER_MODELS[0].id; // tiny
const MODEL_ACCURATE = WHISPER_MODELS[1].id; // base
const PREVIEW_MAX_EDGE = 1080;

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Shared bits of chrome

/** Primary call-to-action: brand gradient pill. */
function PrimaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-sys-indigo text-[17px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(10,132,255,0.7)] transition active:scale-[0.98] disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.06] px-5 text-[15px] font-semibold text-white transition active:bg-white/10 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * The screen's main action, pinned to the bottom of the viewport. Sits
 * above the home indicator and, on iPhone, above Safari's floating address
 * bar, which otherwise covers a button that scrolls to the very bottom.
 */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 bg-[linear-gradient(to_top,black_78%,transparent)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7">
      {children}
    </div>
  );
}

/** iOS-style segmented control. */
function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; aria?: string }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("inline-flex rounded-full bg-white/[0.06] p-1", className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex-1 rounded-full font-semibold transition",
              size === "sm" ? "px-3 py-1 text-[13px]" : "px-3.5 py-1.5 text-[14px]",
              active ? "bg-white text-black shadow-sm" : "text-label-2 active:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx("relative h-[30px] w-[50px] shrink-0 rounded-full transition", on ? "bg-sys-green" : "bg-white/15")}
    >
      <span className={cx("absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition", on ? "left-[23px]" : "left-[3px]")} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// TEMP — export timer for on-device testing. Starts when Export is tapped,
// stays pinned on screen, logs each stage. To remove: delete this block,
// the `timing` state and its updates in MobileEditor, and <ExportTimer />.

interface ExportTiming {
  startedAt: number;
  endedAt: number | null;
  /** Stage changes, in order, each stamped with performance.now(). */
  marks: { label: string; at: number }[];
  outcome: "running" | "done" | "stopped" | "failed";
  engine: string | null;
  clipSeconds: number;
  output?: string;
  stats?: ExportStats;
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

function ExportTimer({ timing }: { timing: ExportTiming }) {
  const [now, setNow] = useState(timing.startedAt);
  const [open, setOpen] = useState(true);
  const running = timing.endedAt === null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  const end = timing.endedAt ?? Math.max(now, timing.startedAt);
  const elapsed = end - timing.startedAt;
  const speed = timing.outcome === "done" && elapsed > 0 && timing.clipSeconds > 0 ? timing.clipSeconds / (elapsed / 1000) : null;
  const tone =
    timing.outcome === "done" ? "border-sys-green/40 text-sys-green" : timing.outcome === "running" ? "border-brand-400/50 text-white" : "border-sys-orange/40 text-sys-orange";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 flex justify-center px-4" data-export-timer>
      <div className={cx("pointer-events-auto w-full max-w-[448px] rounded-2xl border bg-black/85 px-3 py-2 font-mono text-[12px] shadow-xl backdrop-blur", tone)}>
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="flex items-center gap-2">
            <span className={cx("h-2 w-2 rounded-full", running ? "animate-pulse bg-brand-400" : timing.outcome === "done" ? "bg-sys-green" : "bg-sys-orange")} />
            <span className="text-[15px] font-semibold tabular-nums" data-export-elapsed>{fmtElapsed(elapsed)}</span>
            <span className="text-label-2">
              {running ? timing.marks[timing.marks.length - 1]?.label ?? "Starting" : timing.outcome === "done" ? "Export finished" : timing.outcome === "stopped" ? "Stopped" : "Failed"}
            </span>
          </span>
          <span className="shrink-0 text-label-3">{open ? "hide" : "log"}</span>
        </button>
        {open && (
          <div className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5 text-[11px] text-label-2">
            {timing.marks.map((m, i) => {
              const next = timing.marks[i + 1]?.at ?? end;
              return (
                <div key={`${m.label}-${m.at}`} className="flex justify-between gap-3 tabular-nums">
                  <span className="truncate">{m.label}</span>
                  <span>{fmtElapsed(next - m.at)}</span>
                </div>
              );
            })}
            {!running && (
              <div className="flex justify-between gap-3 border-t border-white/10 pt-1 tabular-nums text-white">
                <span>
                  {timing.engine ? `${timing.engine} engine` : "total"} · clip {fmtTime(timing.clipSeconds)}
                </span>
                <span>{speed ? `${speed.toFixed(1)}× real time` : fmtElapsed(elapsed)}</span>
              </div>
            )}
            {!running && timing.stats && (
              <div className="space-y-0.5 border-t border-white/10 pt-1 tabular-nums" data-export-stats>
                <div className="truncate">
                  {timing.stats.source} → {timing.output}
                </div>
                <div>
                  per frame: draw {timing.stats.msVideo.toFixed(1)} · captions {timing.stats.msCaptions.toFixed(1)} · decode+encode {timing.stats.msOther.toFixed(1)} ms
                </div>
                <div>
                  {timing.stats.frames} frames · {(timing.stats.frames / Math.max(0.001, elapsed / 1000)).toFixed(0)} fps · {timing.stats.captionRenders} caption renders
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function MobileEditor() {
  const [step, setStep] = useState<Step>("pick");
  const [support, setSupport] = useState<LiteSupport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
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
      const info = await probeVideo(picked);
      if (controller.signal.aborted) return;
      setDuration(info.duration);
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
      const res = await transcribeSamples(decoded.speech, {
        model,
        language: "auto",
        device,
        threads,
        repetitionPenalty: 1.2,
        onProgress,
        signal: controller.signal,
      });
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
      } else {
        setError({ message: e instanceof Error ? e.message : String(e), detail: e instanceof Error && e.name !== "Error" ? e.name : undefined });
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
      const streaming = duration > LONG_SECONDS || params.get("stream") === "1";
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
            debugMode: (["passthrough", "nocaptions", "resize-only", "gl", "2d"] as FastExportDebugMode[]).find((m) => m === params.get("fx")),
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
      setError({ message: e instanceof Error ? e.message : String(e) });
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

// ---------------------------------------------------------------------------

function PickScreen({
  support,
  accurate,
  onAccurate,
  onPick,
}: {
  support: LiteSupport | null;
  accurate: boolean;
  onAccurate: (v: boolean) => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const unsupported = support && !support.ok;
  const homeScreenTip = useSyncExternalStore(noopSubscribe, readHomeScreenTip, () => false);
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative overflow-hidden rounded-[28px] bg-[#101012] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.55)]">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-brand-500/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-10 h-56 w-56 rounded-full bg-sys-indigo/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-label-2">
            <Sparkles size={12} className="text-sys-yellow" /> Whisper on your phone · nothing uploaded
          </span>
          <h1 className="mt-4 text-[32px] font-bold leading-[1.05] tracking-tight">
            Captions,
            <br />
            in a tap.
          </h1>
          <p className="mt-3 text-[15px] leading-snug text-label-2">Pick a clip, choose a look, save it back to Photos. About a minute for a five-minute video.</p>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onPick(f);
            }}
          />
          <PrimaryButton className="mt-6" onClick={() => inputRef.current?.click()} disabled={!!unsupported}>
            <Upload size={18} /> Choose a video
          </PrimaryButton>
          <p className="mt-2.5 text-center text-[11px] leading-snug text-label-3">
            <span className="text-label-2">Photo Library</span> for your camera roll · <span className="text-label-2">Choose File</span> for a clip in Files
          </p>
          {unsupported && (
            <p className="mt-3 flex items-start gap-2 text-[13px] text-sys-orange">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {support?.reason}
            </p>
          )}
        </div>
      </div>

      {/* Three steps */}
      <ol className="mt-4 grid grid-cols-3 gap-2">
        {[
          { n: 1, icon: Upload, label: "Pick a clip" },
          { n: 2, icon: Wand2, label: "Choose a look" },
          { n: 3, icon: Share2, label: "Save to Photos" },
        ].map(({ n, icon: Icon, label }) => (
          <li key={n} className="rounded-2xl bg-white/[0.04] p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] text-label-2">
              <Icon size={15} />
            </span>
            <p className="mt-2 text-[12px] font-medium leading-tight">
              <span className="text-label-3">{n}. </span>
              {label}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">Speech model</p>
          <p className="text-[11px] text-label-2">{accurate ? "Best for crowds, rooms, noise · 80 MB once" : "Quiet, clear speech · 45 MB once"}</p>
        </div>
        <Segmented
          size="sm"
          value={accurate ? "accurate" : "fast"}
          options={[
            { value: "accurate", label: "Accurate" },
            { value: "fast", label: "Fast" },
          ]}
          onChange={(v) => onAccurate(v === "accurate")}
        />
      </div>

      {homeScreenTip && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-label-3">
          <ChevronUp size={12} /> Share → <span className="text-label-2">Add to Home Screen</span> to use it like an app
        </p>
      )}

      <p className="mt-auto pt-6 text-center text-[11px] text-label-3">
        For timelines, transitions and more, use the desktop editor.
        <span className="mt-1 block font-mono text-[10px] text-label-3/70">build {process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}</span>
      </p>
    </div>
  );
}

function StatusLine({ status }: { status: { message: string; progress: number | null; detail?: string } }) {
  const pct = status.progress === null ? null : Math.round(status.progress * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[15px]">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 size={15} className="animate-spin text-brand-400" /> {status.message}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={cx("h-full rounded-full bg-gradient-to-r from-brand-500 to-sys-indigo transition-[width]", pct === null && "w-1/3 animate-pulse")}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {status.detail && <p className="mt-1.5 truncate text-[12px] text-label-2">{status.detail}</p>}
    </div>
  );
}

function ProgressScreen({
  title,
  status,
  note,
  onCancel,
}: {
  title: string;
  status: { message: string; progress: number | null; detail?: string };
  note: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative overflow-hidden rounded-[28px] bg-[#101012] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.55)]">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="relative">
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] text-sys-yellow">
            <span className="absolute inset-0 animate-ping rounded-2xl bg-sys-yellow/10" />
            <Sparkles size={26} />
          </span>
          <p className="mt-4 text-[22px] font-bold tracking-tight">{title}</p>
          <div className="mt-4">
            <StatusLine status={status} />
          </div>
        </div>
      </div>
      <p className="mt-3 px-2 text-center text-[12px] leading-snug text-label-2">{note}</p>
      <div className="flex-1" />
      <ActionBar>
        <SecondaryButton className="w-full" onClick={onCancel}>
          <X size={15} /> Cancel
        </SecondaryButton>
      </ActionBar>
    </div>
  );
}

// ---------------------------------------------------------------------------

type Tab = "frame" | "looks" | "style" | "text";

const POSITION_PRESETS: { label: string; y: number }[] = [
  { label: "Top", y: 0.16 },
  { label: "Middle", y: 0.5 },
  { label: "Bottom", y: 0.8 },
];

function StyleScreen({
  fileUrl,
  cues,
  setCues,
  style,
  setStyle,
  wordsPerCue,
  setWordsPerCue,
  reframe,
  setReframe,
  onExport,
}: {
  fileUrl: string;
  cues: CaptionCue[];
  setCues: (c: CaptionCue[]) => void;
  style: SubtitleStyle;
  setStyle: (s: SubtitleStyle) => void;
  wordsPerCue: number;
  setWordsPerCue: (n: number) => void;
  reframe: Reframe;
  setReframe: (r: Reframe) => void;
  onExport: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** Source pixel size, known once metadata loads. */
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [tab, setTab] = useState<Tab>("looks");
  const [dragging, setDragging] = useState(false);
  const cuesRef = useRef(cues);
  const styleRef = useRef(style);
  const reframeRef = useRef(reframe);
  useEffect(() => {
    cuesRef.current = cues;
    styleRef.current = style;
    reframeRef.current = reframe;
  });

  /** Draws the captions for the video's current time onto the overlay,
   * which covers the *output frame* (the crop), not the whole source. */
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const out = outputFrame(video.videoWidth, video.videoHeight, reframeRef.current, PREVIEW_MAX_EDGE);
    if (canvas.width !== out.width || canvas.height !== out.height) {
      canvas.width = out.width;
      canvas.height = out.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, out.width, out.height);
    const t = video.currentTime;
    for (const cue of cuesRef.current) {
      if (t >= cue.start && t < cue.end) drawCue(ctx, cue, styleRef.current, out, t, { showTranslated: false });
    }
  }, []);

  // Redraw while playing from a requestAnimationFrame loop rather than
  // requestVideoFrameCallback: iOS Safari stops delivering frame callbacks
  // after a video is seeked while paused (which the #t=0.1 first-frame
  // fix does), and rAF is immune to that.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let stopped = false;
    let lastDrawn = -1;
    const loop = () => {
      if (stopped) return;
      if (!video.paused && !video.ended && video.currentTime !== lastDrawn) {
        lastDrawn = video.currentTime;
        draw();
        setTime(video.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onMeta = () => {
      setDuration(video.duration);
      setDims({ w: video.videoWidth, h: video.videoHeight });
      // iOS Safari shows a black box for a paused video until it has
      // seeked at least once; a tiny seek paints the first frame.
      if (video.currentTime === 0) video.currentTime = 0.01;
      draw();
    };
    const onSeeked = () => {
      draw();
      setTime(video.currentTime);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", onSeeked);
    // Metadata may already be in by the time this effect runs (blob URLs
    // load instantly) — the event would be missed, so apply it now too.
    if (video.readyState >= 1) onMeta();
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onSeeked);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onSeeked);
    };
  }, [draw]);

  // Style, cue or frame edits while paused should show immediately.
  useEffect(() => {
    draw();
  }, [cues, style, reframe, draw]);

  const preset = getPreset(style.presetId);
  const activeIndex = useMemo(() => cues.findIndex((c) => time >= c.start && time < c.end), [cues, time]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
  };

  // The frame box has the output shape; the <video> is sized and offset
  // inside it so exactly the crop rectangle shows (same maths as export).
  const aspect = dims ? aspectOf(reframe.format, dims.w, dims.h) : 16 / 9;
  const crop = dims ? cropRect(dims.w, dims.h, reframe) : null;
  const videoStyle: React.CSSProperties | undefined =
    dims && crop
      ? {
          width: `${(dims.w / crop.w) * 100}%`,
          height: `${(dims.h / crop.h) * 100}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }
      : { width: "100%", height: "100%", left: 0, top: 0 };

  // Gestures on the frame. Tap = play/pause. On the Frame tab a drag pans
  // the video and a two-finger pinch zooms it; on every other tab a drag
  // moves the caption.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; pinchDist: number; pinchZoom: number } | null>(null);
  const framing = tab === "frame";

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, startX: e.clientX, startY: e.clientY, pinchDist: 0, pinchZoom: reframeRef.current.zoom };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.pinchZoom = reframeRef.current.zoom;
      gesture.current.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const prev = pointers.current.get(e.pointerId);
    if (!g || !prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    if (pointers.current.size >= 2) {
      if (!framing || !g.pinchDist) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setDragging(true);
      setReframe(withZoom(reframeRef.current, g.pinchZoom * (dist / g.pinchDist)));
      return;
    }

    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 8) return;
    g.moved = true;
    setDragging(true);

    if (framing) {
      if (!dims) return;
      const c = cropRect(dims.w, dims.h, reframeRef.current);
      const perPx = c.w / rect.width; // source pixels per screen pixel
      setReframe(panBy(dims.w, dims.h, reframeRef.current, (e.clientX - prev.x) * perPx, (e.clientY - prev.y) * perPx));
    } else {
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const x = Math.abs(fx - 0.5) < 0.06 ? 0.5 : Math.min(0.85, Math.max(0.15, fx));
      const y = Math.min(0.95, Math.max(0.08, fy));
      setStyle({ ...styleRef.current, x, y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (g && !g.moved) togglePlay();
  };

  const formatLabel = FRAME_FORMATS.find((f) => f.id === reframe.format)?.label ?? "Original";
  const summary = `${formatLabel} · ${preset.name} · ${cues.length} captions`;

  return (
    <div className="flex flex-1 flex-col">
      {/* Preview: a box in the output shape, the video cropped inside it */}
      <div
        ref={frameRef}
        className={cx(
          "relative mx-auto touch-none select-none overflow-hidden rounded-[24px] bg-black shadow-[0_20px_50px_rgba(0,0,0,0.6)]",
          dragging && "ring-2 ring-brand-400",
        )}
        style={{ aspectRatio: String(aspect), width: `min(100%, calc(56dvh * ${aspect}))` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video ref={videoRef} src={`${fileUrl}#t=0.1`} playsInline preload="auto" className="absolute max-w-none bg-black object-fill" style={videoStyle} />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        {framing && (
          // Rule-of-thirds guide while reframing.
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/60" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/60" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/60" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/60" />
          </div>
        )}
        {!playing && !dragging && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 backdrop-blur">
            <Play size={26} className="translate-x-0.5" />
          </span>
        )}
        {dragging && (
          <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium backdrop-blur">
            {framing ? "Drag to move · pinch to zoom" : "Drag to place captions"}
          </span>
        )}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-10 text-[12px] tabular-nums"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={togglePlay} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
          </button>
          <span className="w-9 text-right">{fmtTime(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(time, duration || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="h-1 min-w-0 flex-1 accent-white"
            aria-label="Scrub"
          />
          <span className="w-9 text-label-2">{fmtTime(duration)}</span>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-label-3">
        {framing ? "Drag the video to move it · pinch to zoom" : "Tap to play · drag the caption to move it"}
      </p>

      {/* Tabs */}
      <Segmented
        className="mt-3 w-full"
        value={tab}
        options={[
          { value: "frame", label: <span className="inline-flex items-center gap-1"><Crop size={14} /> Frame</span> },
          { value: "looks", label: <span className="inline-flex items-center gap-1"><Wand2 size={14} /> Looks</span> },
          { value: "style", label: <span className="inline-flex items-center gap-1"><Type size={14} /> Style</span> },
          { value: "text", label: <span className="inline-flex items-center gap-1"><Check size={14} /> Text</span> },
        ]}
        onChange={setTab}
      />

      <div className="mt-3 min-h-[13rem]">
        {tab === "frame" && (
          <div className="space-y-2.5">
            <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {FRAME_FORMATS.map((f) => {
                const active = f.id === reframe.format;
                const ratio = f.ratio ?? (dims ? dims.w / dims.h : 16 / 9);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-label={`Frame ${f.label}`}
                    onClick={() => setReframe({ ...DEFAULT_REFRAME, format: f.id })}
                    className={cx(
                      "flex h-[84px] w-[92px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border bg-[#141416] transition active:scale-[0.97]",
                      active ? "border-brand-400 shadow-[0_0_0_3px_rgba(64,156,255,0.25)]" : "border-white/[0.06]",
                    )}
                  >
                    <span
                      className={cx("block rounded-[4px] border-2", active ? "border-brand-400" : "border-white/50")}
                      style={ratio >= 1 ? { width: 30, height: 30 / ratio } : { height: 30, width: 30 * ratio }}
                    />
                    <span className="text-[13px] font-semibold leading-none">{f.label}</span>
                    <span className="text-[10px] leading-none text-label-3">{f.hint}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Zoom</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Zoom out" onClick={() => setReframe(withZoom(reframe, +(reframe.zoom - 0.1).toFixed(2)))} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Minus size={15} />
                </button>
                <span className="w-12 text-center text-[14px] tabular-nums">{Math.round(reframe.zoom * 100)}%</span>
                <button type="button" aria-label="Zoom in" onClick={() => setReframe(withZoom(reframe, Math.min(MAX_ZOOM, +(reframe.zoom + 0.1).toFixed(2))))} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <div>
                <p className="text-[14px] font-medium">Centre the video</p>
                <p className="text-[11px] text-label-2">Undo your drag and zoom</p>
              </div>
              <SecondaryButton className="h-9 px-4 text-[13px]" onClick={() => setReframe({ ...DEFAULT_REFRAME, format: reframe.format })}>
                <RotateCcw size={14} /> Reset
              </SecondaryButton>
            </div>
          </div>
        )}

        {tab === "looks" && (
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            {CAPTION_PRESETS.map((p) => {
              const active = p.id === style.presetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStyle({ ...style, presetId: p.id })}
                  aria-label={p.name}
                  className={cx(
                    "relative flex h-[76px] w-[104px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border bg-[#141416] transition active:scale-[0.97]",
                    active ? "border-brand-400 shadow-[0_0_0_3px_rgba(64,156,255,0.25)]" : "border-white/[0.06]",
                  )}
                >
                  {active && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-400 text-black">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                  <span
                    className="max-w-full truncate px-1.5 text-[16px] leading-none"
                    style={{
                      fontFamily: fontFamily(p.font),
                      fontWeight: p.weight,
                      fontStyle: p.italic ? "italic" : undefined,
                      color: p.color,
                      textTransform: p.uppercase ? "uppercase" : undefined,
                      background: p.box?.color,
                      borderRadius: 4,
                      padding: p.box ? "2px 5px" : undefined,
                      WebkitTextStroke: p.stroke ? `0.6px ${p.stroke.color}` : undefined,
                      textShadow: p.shadow ? `0 1px 2px ${p.shadow.color}` : p.glow ? `0 0 6px ${p.glow.color}` : undefined,
                    }}
                  >
                    {p.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-label-3">{p.category}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === "style" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Position</span>
              <Segmented
                size="sm"
                value={POSITION_PRESETS.find((p) => Math.abs(p.y - style.y) < 0.06)?.label ?? "custom"}
                options={POSITION_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
                onChange={(label) => {
                  const p = POSITION_PRESETS.find((x) => x.label === label);
                  if (p) setStyle({ ...style, x: 0.5, y: p.y });
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Size</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Smaller" onClick={() => setStyle({ ...style, sizeScale: Math.max(0.6, +(style.sizeScale - 0.1).toFixed(2)) })} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Minus size={15} />
                </button>
                <span className="w-12 text-center text-[14px] tabular-nums">{Math.round(style.sizeScale * 100)}%</span>
                <button type="button" aria-label="Larger" onClick={() => setStyle({ ...style, sizeScale: Math.min(1.8, +(style.sizeScale + 0.1).toFixed(2)) })} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Words per caption</span>
              <Segmented size="sm" value={wordsPerCue} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} onChange={setWordsPerCue} />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <div>
                <p className="text-[14px] font-medium">Highlight the spoken word</p>
                <p className="text-[11px] text-label-2">Karaoke-style accent as each word is said</p>
              </div>
              <Toggle on={style.highlight} onChange={(v) => setStyle({ ...style, highlight: v })} label="Highlight the spoken word" />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <div>
                <p className="text-[14px] font-medium">ALL CAPS</p>
                <p className="text-[11px] text-label-2">{style.uppercase === null ? "Following the look" : style.uppercase ? "On" : "Off"}</p>
              </div>
              <Toggle on={style.uppercase ?? !!preset.uppercase} onChange={(v) => setStyle({ ...style, uppercase: v })} label="All caps" />
            </div>
          </div>
        )}

        {tab === "text" && (
          <TranscriptPanel cues={cues} setCues={setCues} activeIndex={activeIndex} playing={playing} seekTo={seekTo} font={fontFamily(preset.font)} />
        )}
      </div>

      <ActionBar>
        <PrimaryButton onClick={onExport}>
          <Sparkles size={18} /> Export video
        </PrimaryButton>
        <p className="mt-2 text-center text-[11px] text-label-3">{summary}</p>
      </ActionBar>
    </div>
  );
}

function TranscriptPanel({
  cues,
  setCues,
  activeIndex,
  playing,
  seekTo,
  font,
}: {
  cues: CaptionCue[];
  setCues: (c: CaptionCue[]) => void;
  activeIndex: number;
  playing: boolean;
  seekTo: (t: number) => void;
  font: string;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  // Follow playback: keep the spoken line in view.
  useEffect(() => {
    if (playing && activeRef.current) activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, playing]);

  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.04]">
      <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-label-3">Tap a time to jump · edit any word</p>
      <ul className="max-h-[38dvh] overflow-y-auto px-2 pb-2">
        {cues.map((cue, i) => {
          const active = i === activeIndex;
          return (
            <li key={cue.id} ref={active ? activeRef : undefined} className={cx("flex items-center gap-2 rounded-xl px-2 py-2", active && "bg-brand-500/20")}>
              <button type="button" onClick={() => seekTo(cue.start + 0.01)} className={cx("w-11 shrink-0 text-left text-[12px] tabular-nums", active ? "text-brand-400" : "text-label-3")}>
                {fmtTime(cue.start)}
              </button>
              <input
                value={cue.text}
                onChange={(e) => setCues(cues.map((c) => (c.id === cue.id ? { ...c, text: e.target.value } : c)))}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                style={{ fontFamily: font }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DoneScreen({
  result,
  resultUrl,
  saved,
  onSave,
  onEdit,
  onNew,
}: {
  result: LiteExportResult;
  resultUrl: string;
  saved: "shared" | "downloaded" | null;
  onSave: () => void;
  onEdit: () => void;
  onNew: () => void;
}) {
  const share = canShareFiles();
  const mb = (result.blob.size / 1_048_576).toFixed(1);
  return (
    <div className="flex flex-1 flex-col">
      <div className="overflow-hidden rounded-[24px] bg-black shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
        <video src={`${resultUrl}#t=0.1`} controls playsInline preload="auto" className="block max-h-[56dvh] w-full bg-black object-contain" />
      </div>
      <div className="mt-3 flex items-center justify-center gap-2 text-[12px] text-label-2">
        <span data-export-engine={result.engine} className="inline-flex items-center gap-1 rounded-full bg-sys-green/15 px-2 py-0.5 font-medium text-sys-green"><Check size={12} /> Ready</span>
        <span>{result.width}×{result.height}</span>
        <span>·</span>
        <span>{fmtTime(result.seconds)}</span>
        <span>·</span>
        <span>{mb} MB</span>
        <span>·</span>
        <span>{result.audio === "none" ? "no audio" : "with audio"}</span>
      </div>
      {result.audio === "none" && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-sys-orange/10 p-3 text-[12px] text-sys-orange">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> This browser couldn&rsquo;t encode audio, so the export is silent. Safari 17+ or Chrome keeps the sound.
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <SecondaryButton onClick={onEdit}><ArrowLeft size={16} /> Adjust</SecondaryButton>
        <SecondaryButton onClick={onNew}><RotateCcw size={16} /> New video</SecondaryButton>
      </div>
      <div className="flex-1" />
      <ActionBar>
        <PrimaryButton onClick={onSave}>
          {share ? <Share2 size={18} /> : <Download size={18} />} {share ? "Save to Photos" : "Download MP4"}
        </PrimaryButton>
        {saved && (
          <p className="mt-2 flex items-center justify-center gap-1.5 text-[13px] text-sys-green">
            <Check size={16} /> {saved === "shared" ? "Choose “Save Video” in the share sheet." : "Downloaded."}
          </p>
        )}
      </ActionBar>
    </div>
  );
}
