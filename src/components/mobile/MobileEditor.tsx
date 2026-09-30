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
import { AlertTriangle, ArrowLeft, Check, Download, Film, Loader2, Monitor, Pause, Play, RotateCcw, Share2, Sparkles, Upload, X } from "lucide-react";
import "@/lib/fonts"; // registers next/font family names for canvas text on the client
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/utils/cx";
import { AudioExtractError, extractAudio, isIOS, type AudioStrategy, type SourceAudio } from "@/lib/mobile/audio";
import { hasWebGPU, transcribeSamples, WHISPER_MODELS } from "@/lib/speech/transcriber";
import type { MlProgress } from "@/lib/speech/mlClient";
import { buildCues, CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { CAPTION_PRESETS, getPreset } from "@/lib/captions/presets";
import { drawCue } from "@/lib/captions/renderer";
import { ensureFontsLoaded, fontFamily } from "@/lib/captions/fonts";
import { defaultSubtitleStyle, type CaptionCue, type SubtitleStyle, type WordTiming } from "@/lib/models/project";
import { checkLiteSupport, exportCaptionedVideo, type LiteExportResult, type LiteProgress, type LiteSupport } from "@/lib/mobile/exportLite";
import { acquireWakeLock, canShareFiles, saveVideo } from "@/lib/mobile/share";
import { probeVideo } from "@/lib/media/probe";

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

export function MobileEditor() {
  const [step, setStep] = useState<Step>("pick");
  const [support, setSupport] = useState<LiteSupport | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState(0);
  const [sourceAudio, setSourceAudio] = useState<SourceAudio | null>(null);
  const [accurate, setAccurate] = useState(false);
  const [status, setStatus] = useState<{ message: string; progress: number | null; detail?: string }>({ message: "", progress: null });
  const [error, setError] = useState<{ message: string; detail?: string } | null>(null);
  const [words, setWords] = useState<WordTiming[]>([]);
  const [cues, setCues] = useState<CaptionCue[]>([]);
  const [style, setStyle] = useState<SubtitleStyle>(() => ({ ...defaultSubtitleStyle(), presetId: "hormozi", y: 0.74 }));
  const [wordsPerCue, setWordsPerCue] = useState(3);
  const [result, setResult] = useState<LiteExportResult | null>(null);
  const [saved, setSaved] = useState<"shared" | "downloaded" | null>(null);
  const restartedDuring = useSyncExternalStore(noopSubscribe, readInflight, () => null);
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
    setResult(null);
    setSaved(null);
    setError(null);
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
      const strategy: AudioStrategy = new URLSearchParams(window.location.search).get("audio") === "ffmpeg" ? "ffmpeg" : "auto";
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
      const res = await transcribeSamples(decoded.speech, { model, language: "auto", device, threads, onProgress, signal: controller.signal });
      if (controller.signal.aborted) return;
      if (res.words.length === 0) throw new Error("Couldn't hear any speech in this video.");
      await ensureFontsLoaded();
      setWords(res.words);
      setCues(buildCues(res.words, { ...CAPTION_RULES, maxWords: wordsPerCue }));
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
    const releaseLock = await acquireWakeLock();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const streaming = duration > LONG_SECONDS || new URLSearchParams(window.location.search).get("stream") === "1";
      const out = await exportCaptionedVideo({
        file,
        audio: sourceAudio,
        streaming,
        cues,
        style,
        video: exportVideoRef.current,
        canvas: exportCanvasRef.current,
        signal: controller.signal,
        onProgress: (p: LiteProgress) => setStatus({ message: p.message, progress: p.progress }),
      });
      setResult(out);
      setStep("done");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setStep("style");
        return;
      }
      console.error("[nocap mobile] export failed", e);
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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col bg-black text-white">
      <header className="flex items-center justify-between px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/40">
            <Film size={18} />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold tracking-tight">NoCap Edit</p>
            <p className="text-[11px] text-label-2">Mobile · on-device</p>
          </div>
        </div>
        {step !== "pick" ? (
          <button type="button" onClick={reset} className="rounded-full bg-sys-gray5 p-2 text-label-2 active:bg-sys-gray4" aria-label="Start over">
            <X size={16} />
          </button>
        ) : (
          <Link href="/" className="flex items-center gap-1 rounded-full bg-sys-gray5 px-3 py-1.5 text-xs text-label-2">
            <Monitor size={13} /> Desktop
          </Link>
        )}
      </header>

      <main className="flex flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-sys-red/30 bg-sys-red/10 p-3 text-sm text-sys-red">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p>{error.message}</p>
              {error.detail && <p className="mt-1 break-words text-[11px] leading-snug text-sys-red/80">{error.detail}</p>}
            </div>
          </div>
        )}

        {step === "pick" && restartedDuring && !error && (
          <div className="mb-3 flex items-start gap-2 rounded-2xl border border-sys-orange/30 bg-sys-orange/10 p-3 text-sm text-sys-orange">
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
            onExport={runExport}
          />
        )}

        {/* The export surface: always mounted so refs exist, shown while exporting. */}
        <div className={cx("flex flex-1 flex-col", step === "exporting" ? "" : "hidden")}>
          <div className="relative overflow-hidden rounded-3xl bg-sys-gray6 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
            <canvas ref={exportCanvasRef} className="block w-full" />
            <video ref={exportVideoRef} muted playsInline className="pointer-events-none absolute left-0 top-0 h-px w-px opacity-[0.01]" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
              <StatusLine status={status} />
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-label-2">Rendering in real time on your phone. Keep the app open — it takes about as long as the clip.</p>
          <Button variant="secondary" size="lg" className="mt-4 w-full" onClick={() => abortRef.current?.abort()}>
            Cancel
          </Button>
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
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative mt-2 overflow-hidden rounded-3xl bg-sys-gray6 p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_50px_rgba(0,0,0,0.5)]">
        <div aria-hidden className="pointer-events-none absolute -top-20 left-1/2 h-56 w-[28rem] -translate-x-1/2 rounded-full bg-sys-blue/20 blur-3xl" />
        <div className="relative">
          <h1 className="text-[28px] font-semibold leading-tight tracking-tight">Captions for your video, in a tap.</h1>
          <p className="mt-2 text-[15px] text-label-2">Pick a clip from Photos. It never leaves your phone.</p>
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
          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={() => inputRef.current?.click()} disabled={!!unsupported}>
            <Upload size={18} /> Choose a video
          </Button>
          {unsupported && (
            <p className="mt-3 flex items-start gap-2 text-sm text-sys-orange">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {support?.reason}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-sys-gray6 p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-label-2">Speech model</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <ModelChoice active={!accurate} onClick={() => onAccurate(false)} title="Fast" note="~45 MB · quick" />
          <ModelChoice active={accurate} onClick={() => onAccurate(true)} title="Accurate" note="~80 MB · better" />
        </div>
      </div>

      <ul className="mt-4 space-y-2 text-[13px] text-label-2">
        <li className="flex items-center gap-2"><Check size={14} className="text-sys-green" /> Whisper runs on your phone, nothing is uploaded</li>
        <li className="flex items-center gap-2"><Check size={14} className="text-sys-green" /> 20 caption looks, word-by-word highlight</li>
        <li className="flex items-center gap-2"><Check size={14} className="text-sys-green" /> Saves straight to Photos</li>
      </ul>
      <p className="mt-auto pt-6 text-center text-[11px] text-label-3">
        Best on Safari 17+ / Chrome. For timelines, transitions and more, use the desktop editor.
        <span className="mt-1 block font-mono text-[10px] text-label-3/70">build {process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}</span>
      </p>
    </div>
  );
}

function ModelChoice({ active, onClick, title, note }: { active: boolean; onClick: () => void; title: string; note: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "rounded-xl border px-3 py-2.5 text-left transition",
        active ? "border-sys-blue bg-sys-blue/15" : "border-white/5 bg-sys-gray5 active:bg-sys-gray4",
      )}
    >
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-[11px] text-label-2">{note}</p>
    </button>
  );
}

function StatusLine({ status }: { status: { message: string; progress: number | null; detail?: string } }) {
  const pct = status.progress === null ? null : Math.round(status.progress * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 size={14} className="animate-spin text-sys-blue" /> {status.message}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={cx("h-full rounded-full bg-sys-blue transition-[width]", pct === null && "w-1/3 animate-pulse")}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {status.detail && <p className="mt-1.5 truncate text-xs text-label-2">{status.detail}</p>}
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
      <div className="relative overflow-hidden rounded-3xl bg-sys-gray6 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_20px_50px_rgba(0,0,0,0.5)]">
        <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-56 w-[28rem] -translate-x-1/2 rounded-full bg-sys-blue/20 blur-3xl" />
        <div className="relative">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sys-gray5 text-sys-yellow shadow-inner shadow-black/40">
            <Sparkles size={26} className="animate-pulse" />
          </span>
          <p className="mt-4 text-xl font-semibold tracking-tight">{title}</p>
          <div className="mt-4">
            <StatusLine status={status} />
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-xs text-label-2">{note}</p>
      <Button variant="secondary" size="lg" className="mt-4 w-full" onClick={onCancel}>Cancel</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StyleScreen({
  fileUrl,
  cues,
  setCues,
  style,
  setStyle,
  wordsPerCue,
  setWordsPerCue,
  onExport,
}: {
  fileUrl: string;
  cues: CaptionCue[];
  setCues: (c: CaptionCue[]) => void;
  style: SubtitleStyle;
  setStyle: (s: SubtitleStyle) => void;
  wordsPerCue: number;
  setWordsPerCue: (n: number) => void;
  onExport: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const cuesRef = useRef(cues);
  const styleRef = useRef(style);
  useEffect(() => {
    cuesRef.current = cues;
    styleRef.current = style;
  });

  /** Draws the captions for the video's current time onto the overlay. */
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.round(video.videoWidth * scale);
    const h = Math.round(video.videoHeight * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const t = video.currentTime;
    for (const cue of cuesRef.current) {
      if (t >= cue.start && t < cue.end) drawCue(ctx, cue, styleRef.current, { width: w, height: h }, t, { showTranslated: false });
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
      // iOS Safari shows a black box for a paused video until it has
      // seeked at least once; a tiny seek paints the first frame.
      if (video.currentTime === 0) video.currentTime = 0.01;
      draw();
    };
    const onSeeked = () => {
      draw();
      setTime(video.currentTime);
    };
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("seeked", onSeeked);
    // Metadata may already be in by the time this effect runs (blob URLs
    // load instantly) — the event would be missed, so apply it now too.
    if (video.readyState >= 1) onMeta();
    video.addEventListener("play", () => setPlaying(true));
    video.addEventListener("pause", () => setPlaying(false));
    video.addEventListener("timeupdate", onSeeked);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("timeupdate", onSeeked);
    };
  }, [draw]);

  // Style or cue edits while paused should show immediately.
  useEffect(() => {
    draw();
  }, [cues, style, draw]);

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

  return (
    <div className="flex flex-1 flex-col">
      <div className="relative overflow-hidden rounded-3xl bg-sys-gray6 shadow-[0_20px_50px_rgba(0,0,0,0.5)]" onClick={togglePlay}>
        <video ref={videoRef} src={`${fileUrl}#t=0.1`} playsInline preload="auto" className="block max-h-[52dvh] w-full bg-black object-contain" />
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
        {!playing && (
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 p-4 backdrop-blur">
            <Play size={24} className="translate-x-0.5" />
          </span>
        )}
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pb-2 pt-8 text-xs tabular-nums" onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={togglePlay} className="rounded-full bg-white/15 p-1.5 backdrop-blur" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span>{fmtTime(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(time, duration || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="h-1 flex-1 accent-white"
            aria-label="Scrub"
          />
          <span className="text-label-2">{fmtTime(duration)}</span>
        </div>
      </div>

      {/* Looks */}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-label-2">Look</p>
      <div className="-mx-4 mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {CAPTION_PRESETS.map((p) => {
          const active = p.id === style.presetId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setStyle({ ...style, presetId: p.id })}
              className={cx(
                "flex h-16 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border transition",
                active ? "border-sys-blue bg-sys-blue/15" : "border-white/5 bg-sys-gray6 active:bg-sys-gray5",
              )}
            >
              <span
                className="max-w-full truncate px-1 text-[15px] leading-none"
                style={{
                  fontFamily: fontFamily(p.font),
                  fontWeight: p.weight,
                  fontStyle: p.italic ? "italic" : undefined,
                  color: p.color,
                  textTransform: p.uppercase ? "uppercase" : undefined,
                  background: p.box?.color,
                  borderRadius: 4,
                  WebkitTextStroke: p.stroke ? `0.6px ${p.stroke.color}` : undefined,
                  textShadow: p.shadow ? `0 1px 2px ${p.shadow.color}` : p.glow ? `0 0 6px ${p.glow.color}` : undefined,
                }}
              >
                {p.name}
              </span>
              <span className="text-[10px] text-label-2">{p.category}</span>
            </button>
          );
        })}
      </div>

      {/* Tweaks */}
      <div className="mt-3 grid grid-cols-2 gap-3 rounded-2xl bg-sys-gray6 p-3 text-xs">
        <label className="space-y-1">
          <span className="flex justify-between text-label-2"><span>Size</span><span className="tabular-nums">{Math.round(style.sizeScale * 100)}%</span></span>
          <input type="range" min={0.6} max={1.6} step={0.05} value={style.sizeScale} onChange={(e) => setStyle({ ...style, sizeScale: Number(e.target.value) })} className="w-full accent-sys-blue" />
        </label>
        <label className="space-y-1">
          <span className="flex justify-between text-label-2"><span>Position</span><span className="tabular-nums">{Math.round(style.y * 100)}%</span></span>
          <input type="range" min={0.3} max={0.9} step={0.01} value={style.y} onChange={(e) => setStyle({ ...style, y: Number(e.target.value) })} className="w-full accent-sys-blue" />
        </label>
        <div className="col-span-2 flex items-center justify-between">
          <span className="text-label-2">Words per caption</span>
          <div className="inline-flex rounded-full bg-sys-gray5 p-0.5">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setWordsPerCue(n)}
                className={cx("rounded-full px-3 py-1 text-xs font-medium", wordsPerCue === n ? "bg-white text-black" : "text-label-2")}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2 flex items-center justify-between">
          <span className="text-label-2">Highlight the spoken word</span>
          <button
            type="button"
            role="switch"
            aria-checked={style.highlight}
            onClick={() => setStyle({ ...style, highlight: !style.highlight })}
            className={cx("relative h-6 w-11 rounded-full transition", style.highlight ? "bg-sys-green" : "bg-sys-gray4")}
          >
            <span className={cx("absolute top-0.5 h-5 w-5 rounded-full bg-white transition", style.highlight ? "left-[22px]" : "left-0.5")} />
          </button>
        </div>
      </div>

      {/* Transcript */}
      <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-label-2">Captions · tap to fix a word</p>
      <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto rounded-2xl bg-sys-gray6 p-2">
        {cues.map((cue, i) => (
          <li key={cue.id} className={cx("flex items-center gap-2 rounded-xl px-2 py-1.5", i === activeIndex && "bg-sys-blue/15")}>
            <button type="button" onClick={() => seekTo(cue.start + 0.01)} className="w-10 shrink-0 text-left text-[11px] tabular-nums text-label-2">
              {fmtTime(cue.start)}
            </button>
            <input
              value={cue.text}
              onChange={(e) => setCues(cues.map((c) => (c.id === cue.id ? { ...c, text: e.target.value } : c)))}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              style={{ fontFamily: fontFamily(preset.font) }}
            />
          </li>
        ))}
      </ul>

      <Button variant="primary" size="lg" className="mt-4 w-full" onClick={onExport}>
        <Sparkles size={18} /> Export video
      </Button>
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
      <div className="overflow-hidden rounded-3xl bg-sys-gray6 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <video src={`${resultUrl}#t=0.1`} controls playsInline preload="auto" className="block max-h-[52dvh] w-full bg-black object-contain" />
      </div>
      <p className="mt-3 text-center text-xs text-label-2">
        {result.width}×{result.height} · {fmtTime(result.seconds)} · {mb} MB · {result.audio === "none" ? "no audio" : "with audio"}
      </p>
      {result.audio === "none" && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-sys-orange/10 p-3 text-xs text-sys-orange">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" /> This browser couldn&rsquo;t encode audio, so the export is silent. Safari 17+ or Chrome keeps the sound.
        </p>
      )}
      <Button variant="primary" size="lg" className="mt-4 w-full" onClick={onSave}>
        {share ? <Share2 size={18} /> : <Download size={18} />} {share ? "Save to Photos" : "Download MP4"}
      </Button>
      {saved && (
        <p className="mt-2 flex items-center justify-center gap-1.5 text-sm text-sys-green">
          <Check size={16} /> {saved === "shared" ? "Choose “Save Video” in the share sheet." : "Downloaded."}
        </p>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" size="lg" onClick={onEdit}><ArrowLeft size={16} /> Adjust</Button>
        <Button variant="secondary" size="lg" onClick={onNew}><RotateCcw size={16} /> New video</Button>
      </div>
    </div>
  );
}
