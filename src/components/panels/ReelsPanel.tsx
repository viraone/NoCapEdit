"use client";
/**
 * Reels: the local model reads the transcript, picks the best moments and each
 * becomes its own reel project (source's frame format, captions carried over).
 * Without captions there is no transcript to read, so Make reels asks for
 * subtitles first and stays here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, Copy, FolderOpen, KeyRound, Share2, Trash2, Square, Captions, Play, RefreshCw, AlertTriangle, Sparkles } from "lucide-react";
import { ReelPreview } from "./ReelPreview";
import { useEditor } from "@/store/editorStore";
import { useProject, useReelSlack } from "./shared";
import { DEFAULT_REEL_SETTINGS, isEmptyReel, listReels, loadReelSettings, makeReels, recutReel, saveReelSettings, type ReelProgress, type ReelSettings } from "@/lib/edit/reelMaker";
import { activeModel, listOllamaModels, loadAiSettings, localAiEnabled, saveAiSettings, type AiSettings } from "@/lib/edit/aiHighlights";
import { AiModelFields } from "./AiModelFields";
import { getFormat } from "@/lib/models/formats";
import { applyGeneratedCaptions, generateCaptions, hasSpeechTrack, type CaptionJobProgress } from "@/lib/speech/generateCaptions";
import { DEFAULT_WHISPER_MODEL } from "@/lib/speech/transcriber";
import { CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { getPreset } from "@/lib/captions/presets";
import { resetMlWorker } from "@/lib/speech/mlClient";
import { projectDuration } from "@/lib/models/timeline";
import type { VideoProject } from "@/lib/models/project";
import { deleteProject, getProject, getProjectThumb } from "@/lib/storage/db";
import { formatTime, nowMs } from "@/lib/utils/time";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** Seconds without any progress report after which the panel says the cut may be stuck. */
const STALL_NOTICE_SECONDS = 90;

export function ReelsPanel() {
  const project = useProject();
  const router = useRouter();
  const format = getFormat(project.formatId);
  /** Inside a reel the panel lists its siblings from the source video instead of cutting more. */
  const isReel = !!(project.sourceProjectId && project.reel);
  const listOwner = isReel ? project.sourceProjectId! : project.id;
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState(localAiEnabled);
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [settings, setSettings] = useState<ReelSettings>(loadReelSettings);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsPending, setModelsPending] = useState(false);
  const isLocalPage = typeof location !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  /** On a public site Chrome gates requests to this computer behind a "local network" permission prompt. */
  const permissionHint = isLocalPage ? "" : " Chrome asks whether this site may reach Ollama on your computer: choose Allow in the prompt. If you dismissed it, click the icon left of the address bar, set Local network access to Allow, and reload.";
  const [reels, setReels] = useState<VideoProject[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [job, setJob] = useState<(ReelProgress & { started: number; /** When the last progress report arrived. */ at: number }) | null>(null);
  /** Seconds since the last progress report: a long quiet spell means the cut is stuck. */
  const [quiet, setQuiet] = useState(0);
  const lastReportRef = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasCues = project.cues.length > 0;
  /** Make reels was pressed without captions: the prompt under the button stays until they exist. */
  const [needCaptions, setNeedCaptions] = useState(false);
  /** "Do this for me": subtitles being generated right here, before the reels are cut. */
  const [captionJob, setCaptionJob] = useState<CaptionJobProgress | null>(null);
  const [captionError, setCaptionError] = useState<string | null>(null);
  const captionAbortRef = useRef<AbortController | null>(null);
  const [preview, setPreview] = useState<VideoProject | null>(null);
  // Inside a one-clip reel: how much of the source video its clip can still be dragged out to show.
  const slack = useReelSlack();
  const only = project.clips.length === 1 ? project.clips[0] : null;
  const canStretch = slack && only ? { before: only.inPoint + slack.before, after: only.duration - only.outPoint + slack.after } : null;

  const updateAi = (patch: Partial<AiSettings>) => {
    const next = { ...aiSettings, ...patch };
    setAiSettings(next);
    saveAiSettings(next);
  };
  const updateSettings = (patch: Partial<ReelSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveReelSettings(next);
  };
  const refreshModels = async () => {
    if (aiSettings.provider !== "ollama") return;
    setModelsError(null);
    setModelsPending(true);
    try {
      setModels(await listOllamaModels(aiSettings.endpoint, AbortSignal.timeout(30000)));
    } catch (e) {
      setModels(null);
      const timedOut = e instanceof DOMException && e.name === "TimeoutError";
      setModelsError((timedOut ? "Ollama didn't answer within 30 s." : "Couldn't list models: is Ollama running?") + permissionHint);
    } finally {
      setModelsPending(false);
    }
  };
  const refreshReels = async () => {
    const list = await listReels(listOwner);
    setReels(list);
    if (isReel) setSourceName((await getProject(listOwner))?.name ?? null);
    const entries: Record<string, string> = {};
    for (const r of list) {
      const t = await getProjectThumb(r.id);
      if (t) entries[r.id] = URL.createObjectURL(t.blob);
    }
    setThumbs((old) => {
      for (const url of Object.values(old)) URL.revokeObjectURL(url);
      return entries;
    });
  };
  useEffect(() => {
    const id = setTimeout(() => {
      void refreshReels();
      if (aiAvailable) void refreshModels();
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);
  // Keyed on the start time, not the whole job: every progress update makes a new job object, and
  // a timer rebuilt on each one never got to fire while updates came faster than once a second.
  const jobStarted = job?.started ?? null;
  const jobAt = job?.at ?? null;
  useEffect(() => {
    lastReportRef.current = jobAt ?? 0;
  }, [jobAt]);
  useEffect(() => {
    if (jobStarted === null) return;
    const id = setInterval(() => {
      setElapsed(Math.round((nowMs() - jobStarted) / 1000));
      setQuiet(Math.round((nowMs() - lastReportRef.current) / 1000));
    }, 1000);
    return () => {
      clearInterval(id);
      setQuiet(0);
    };
  }, [jobStarted]);
  useEffect(() => () => abortRef.current?.abort(), []);
  const cancelCaptions = () => {
    if (!captionAbortRef.current) return;
    captionAbortRef.current.abort();
    captionAbortRef.current = null;
    resetMlWorker();
    setCaptionJob(null);
  };
  useEffect(() => cancelCaptions, []);

  const run = async () => {
    if (job) return;
    if (!useEditor.getState().project?.cues.length) {
      // Nothing to read yet: ask for subtitles and stay here.
      setNeedCaptions(true);
      return;
    }
    setError(null);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setElapsed(0);
    setJob({ stage: "Starting", progress: null, started: nowMs(), at: nowMs() });
    try {
      const result = await makeReels({
        project: useEditor.getState().project!,
        count: settings.count,
        targetSeconds: settings.targetSeconds,
        settings: aiSettings,
        signal: controller.signal,
        onProgress: (p) => setJob((j) => (j ? { ...p, started: j.started, at: nowMs() } : j)),
      });
      await refreshReels();
      const short = result.found < settings.count ? ` The model only found ${result.found} moment${result.found === 1 ? "" : "s"} that fit ${settings.targetSeconds} s.` : "";
      const dup = result.skipped ? ` ${result.skipped} already existed and ${result.skipped === 1 ? "was" : "were"} skipped.` : "";
      setNote(`${result.made.length} reel${result.made.length === 1 ? "" : "s"} ready.${short}${dup}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError((e instanceof Error ? e.message : String(e)) + (/reach Ollama/i.test(String(e)) ? permissionHint : ""));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };
  /**
   * "Do this for me": transcribes on this device with the default model,
   * right here in the panel, puts the captions on the project and then cuts
   * the reels as if Make reels had been pressed with captions in place.
   */
  const doItForMe = async () => {
    if (captionJob || job) return;
    setCaptionError(null);
    const current = useEditor.getState().project!;
    if (!hasSpeechTrack(current.clips)) {
      setCaptionError("None of the clips has an audio track, so there is nothing to transcribe.");
      return;
    }
    const controller = new AbortController();
    captionAbortRef.current = controller;
    const cuesAtStart = current.cues;
    const language = current.captions.sourceLanguage || "auto";
    setCaptionJob({ message: "Starting", progress: null });
    let ready = false;
    try {
      const g = await generateCaptions({
        clips: current.clips,
        model: DEFAULT_WHISPER_MODEL,
        language,
        device: "auto",
        diarize: false,
        maxSpeakers: 3,
        rules: { ...CAPTION_RULES, maxWords: getPreset(current.subtitleStyle.presetId).wordsPerCue ?? CAPTION_RULES.maxWords },
        signal: controller.signal,
        onProgress: setCaptionJob,
      });
      // The user may have moved on to another project while it ran.
      if (useEditor.getState().project?.id !== current.id) return;
      if (!g) {
        setCaptionError("No speech was found in the video, so there is no transcript to read.");
        return;
      }
      useEditor.getState().update((p) => void applyGeneratedCaptions(p, cuesAtStart, g, language, false));
      useEditor.getState().setNotice(`${g.cues.length} captions from ${g.wordCount} words (${g.device || "on-device"}). Cutting the reels now.`);
      setNeedCaptions(false);
      ready = true;
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setCaptionError(e instanceof Error ? e.message : String(e));
    } finally {
      captionAbortRef.current = null;
      setCaptionJob(null);
    }
    if (ready) void run();
  };
  // "Make reels" from the project menu lands here: with captions it runs, without them it asks
  // for subtitles. The request is cleared from the store as it is taken, so a later visit does
  // not run it again (a ref would not do: Strict Mode's second effect pass would see it as taken).
  const reelsRequest = useEditor((s) => s.reelsRequest);
  useEffect(() => {
    if (!reelsRequest) return;
    const id = setTimeout(() => {
      useEditor.setState({ reelsRequest: 0 });
      void run();
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reelsRequest]);

  /** Cuts an empty reel again from its remembered range (no model needed); reloads it if it's the one open. */
  const recut = async (r: VideoProject) => {
    if (job) return;
    setError(null);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setElapsed(0);
    setJob({ stage: "Starting", progress: null, started: nowMs(), at: nowMs() });
    try {
      const source = isReel ? await getProject(listOwner) : useEditor.getState().project!;
      if (!source) throw new Error("The source video is no longer on this device.");
      await recutReel({ source, reel: r, signal: controller.signal, onProgress: (p) => setJob((j) => (j ? { ...p, started: j.started, at: nowMs() } : j)) });
      await refreshReels();
      if (r.id === project.id) {
        await useEditor.getState().loadProject(r.id);
        useEditor.getState().setTool("reels");
      }
      setNote(`Reel ${r.reel?.index} is cut again.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };
  // The progress card reads top-down: which reel, what step, any detail, the bar, then time and Cancel.
  const jobBlock = job && (
    <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-3" data-reel-job>
      <p className="text-[13px] font-semibold leading-snug text-white" data-job-headline>
        {job.reel ? `Cutting reel ${job.reel.n} of ${job.reel.of}${job.reel.title ? ` · ${job.reel.title}` : ""}` : job.stage}
      </p>
      {job.reel && <p className="text-[13px] text-white">{job.stage}</p>}
      {job.detail && <p className="text-[12px] leading-snug text-label-2">{job.detail}</p>}
      <ProgressBar value={job.progress} />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] tabular-nums text-label-2">{formatTime(elapsed, false)} elapsed</span>
        <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
          <Square size={12} /> Cancel
        </Button>
      </div>
      {quiet >= STALL_NOTICE_SECONDS && (
        <p className="rf-read-note rf-warn" data-job-stalled>
          <b>No progress for {formatTime(quiet, false)}.</b> It may be stuck. Press Cancel, then Make reels again. Reels already made are kept.
        </p>
      )}
    </div>
  );

  /** The reel rows: thumbnail previews here, open in the editor, export, delete. In a reel, the one being edited is marked and a single click opens a sibling. */
  const reelList = () => (
    <ul className="space-y-1.5" data-reel-list>
      {reels.map((r) => {
        const current = isReel && r.id === project.id;
        // The reel being edited reads its length and start from the live project, so a trim or stretch shows at once.
        const shown = current ? project : r;
        const empty = isEmptyReel(r);
        // Land on the Reels tool so the list of siblings and the way back stay in view.
        const open = () => !current && router.push(`/editor?id=${r.id}&tool=reels`);
        return (
          <li
            key={r.id}
            data-reel={r.id}
            data-current={current || undefined}
            className={`flex items-center gap-2 rounded-lg border p-2 select-none ${current ? "border-sys-blue bg-sys-blue/10" : "cursor-pointer border-sys-gray4 bg-sys-gray5 hover:border-sys-gray3"}`}
            title={current ? "You're editing this reel" : isReel ? "Click to open this reel" : "Double-click to open this reel in the editor; press the thumbnail to preview it here"}
            onClick={isReel ? open : undefined}
            onDoubleClick={open}
          >
            <button type="button" className="group relative h-14 w-9 shrink-0 overflow-hidden rounded bg-sys-gray6" onClick={(e) => (e.stopPropagation(), !empty && setPreview(r))} aria-label={empty ? "This reel is empty" : "Play this reel"} disabled={empty}>
              {thumbs[r.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[r.id]} alt="" className="h-full w-full object-cover" />
              ) : null}
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-80 group-hover:opacity-100">
                {empty ? <AlertTriangle size={14} className="text-sys-orange" /> : <Play size={14} fill="currentColor" />}
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-[12px] font-semibold">
                {/* The title gives way; the badge is never cut short. */}
                <span className="min-w-0 truncate">{r.reel?.title}</span>
                {current && <span className="shrink-0 rounded bg-sys-blue px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">Editing</span>}
              </p>
              {empty ? (
                <p className="text-[11px] text-sys-orange" data-reel-empty>
                  Reel {r.reel?.index} · empty: the cut didn&apos;t finish
                </p>
              ) : (
                <p className="text-[11px] tabular-nums text-label-2">
                  Reel {r.reel?.index} · {r.reel?.score}/10 · {formatTime(projectDuration(shown.clips))} · from {formatTime(shown.reel?.start ?? 0)}
                </p>
              )}
            </div>
            {!current && (
              <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), router.push(`/editor?id=${r.id}&tool=reels`))} title="Open this reel">
                <FolderOpen size={13} />
              </Button>
            )}
            {empty ? (
              <Button variant="ghost" size="iconSm" className="text-sys-orange" onClick={(e) => (e.stopPropagation(), void recut(r))} title="Cut this reel again from the source" disabled={!!job} data-recut>
                <RefreshCw size={13} />
              </Button>
            ) : (
              <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), router.push(`/editor?id=${r.id}&tool=export`))} title="Export this reel">
                <Share2 size={13} />
              </Button>
            )}
            {!current && (
              <Button
                variant="ghost"
                size="iconSm"
                className="text-sys-red"
                title="Delete this reel"
                onClick={async (e) => {
                  e.stopPropagation();
                  await deleteProject(r.id);
                  void refreshReels();
                }}
              >
                <Trash2 size={13} />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );

  if (isReel) {
    const backHref = `/editor?id=${project.sourceProjectId}&tool=reels`;
    return (
      <>
        <PanelHeader
          title="Reels"
          body={
            <>
              <p className="rf-read">
                You&apos;re editing <b>Reel {project.reel?.index}</b> of {sourceName ? <b>&ldquo;{sourceName}&rdquo;</b> : "the source video"}.
              </p>
              <p className="rf-read-note mt-1.5">Click another reel below to switch, or go back to the source video to make more.</p>
            </>
          }
        />
        <PanelSection>
          <Button variant="primary" size="md" className="w-full min-w-0" onClick={() => router.push(backHref)} data-all-reels title={`Back to ${sourceName ? `"${sourceName}"` : "the source video"} and the list of all its reels`}>
            <ArrowLeft size={14} className="shrink-0" />
            {/* A long source name ellipsizes instead of running past the end of the button. */}
            <span className="min-w-0 truncate">All reels{sourceName ? ` · ${sourceName}` : ""}</span>
          </Button>
          <p className="rf-read-note">
            The source keeps the <b>full transcript</b>. Make reels there adds to this list.
          </p>
        </PanelSection>
        {canStretch && (canStretch.before > 0.05 || canStretch.after > 0.05) && (
          <PanelSection title="Want more of the moment?">
            <div className="space-y-1.5" data-reel-stretch-hint>
              <p className="rf-read">
                <b>Drag either end</b> of the clip on the timeline past where it stops. Video, sound and captions come back from the source.
              </p>
              <p className="rf-read-note">
                Still there: <b className="rf-mono">{formatTime(canStretch.before)}</b> before, <b className="rf-mono">{formatTime(canStretch.after)}</b> after.
              </p>
            </div>
          </PanelSection>
        )}
        {(isEmptyReel(project) || job || error || note) && (
          <PanelSection title={isEmptyReel(project) ? "This reel is empty" : undefined}>
            {isEmptyReel(project) && !job && (
              <>
                <p className="rf-read flex items-start gap-2" data-empty-reel>
                  <AlertTriangle size={15} className="mt-[3px] shrink-0 text-sys-orange" />
                  <span>
                    <b>The cut didn&apos;t finish</b>, so there&apos;s no video here. Cut it again (no model needed), or delete it from the source&apos;s list.
                  </span>
                </p>
                <Button variant="primary" size="sm" className="w-full" onClick={() => void recut(project)} data-recut-current>
                  <RefreshCw size={13} /> Cut this reel again
                </Button>
              </>
            )}
            {jobBlock}
            {error && <p className="whitespace-pre-wrap text-[11px] text-sys-red">{error}</p>}
            {note && <p className="text-[11px] text-sys-green">{note}</p>}
          </PanelSection>
        )}
        <PanelSection title={`All reels (${reels.length})`}>{reels.length ? reelList() : <p className="rf-read-note">Loading…</p>}</PanelSection>
        {preview && <ReelPreview reel={preview} onClose={() => setPreview(null)} />}
      </>
    );
  }

  if (!aiAvailable) {
    const origin = typeof location !== "undefined" ? location.origin : "https://nocapedit.com";
    const command = `OLLAMA_ORIGINS=${origin} ollama serve`;
    /** Turns the Reels tool on in this browser; `provider` also picks who reads the transcript (Ollama stays the default otherwise). */
    const enable = (provider?: AiSettings["provider"]) => {
      try {
        localStorage.setItem("reelflow.localAi", "1");
      } catch {
        /* storage unavailable */
      }
      if (provider) updateAi({ provider });
      setAiAvailable(true);
    };
    return (
      <>
        <PanelHeader
          title="Reels"
          body={
            <p className="rf-read" data-reels-choose>
              A model <b>reads your transcript</b> and picks the best moments. <b>Choose how it runs.</b>
            </p>
          }
        />
        <PanelSection>
          <div className="space-y-2.5 rounded-xl border border-sys-gray4 bg-sys-gray5/40 p-3" data-reels-option="ollama">
            <p className="flex items-center justify-between gap-2 text-[13px] font-semibold text-white">
              <span>Ollama on this computer</span>
              <span className="shrink-0 rounded bg-sys-green/15 px-1.5 py-0.5 text-[11px] text-sys-green">Free · private</span>
            </p>
            <ol className="rf-read-note rf-steps">
              <li>
                <span>
                  <b>Install</b> Ollama from ollama.com
                </span>
              </li>
              <li>
                <span>
                  <b>Pull</b> a model: <span className="rf-mono whitespace-nowrap">ollama pull qwen3.8:27b</span>
                </span>
              </li>
              <li>
                <span>
                  <b>Start</b> it so this site may call it:
                </span>
              </li>
            </ol>
            <code className="rf-mono block whitespace-pre-wrap rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-2 text-[12px] leading-snug text-white/85 [overflow-wrap:anywhere]" data-ollama-command>
              {/* A line break may fall after the "=", so the address stays whole; the copied text has none. */}
              {command.replace("=", "=\u200b")}
            </code>
            <Button variant="secondary" size="sm" className="w-full" onClick={() => navigator.clipboard?.writeText(command).then(() => setNote("Copied the command."))} title="Copy the command">
              <Copy size={13} /> Copy the command
            </Button>
            <Button variant="primary" size="md" className="w-full" onClick={() => enable()} data-use-ollama>
              <Clapperboard size={14} /> Use Ollama
            </Button>
          </div>
          <div className="space-y-2.5 rounded-xl border border-sys-gray4 bg-sys-gray5/40 p-3" data-reels-option="key">
            <p className="flex items-center justify-between gap-2 text-[13px] font-semibold text-white">
              <span>Your own API key</span>
              <span className="shrink-0 rounded bg-sys-orange/15 px-1.5 py-0.5 text-[11px] text-sys-orange">Billed to you</span>
            </p>
            <p className="rf-read-note">
              <b>Claude, Gemini, Grok</b> or any OpenAI-compatible API. Only the <b>transcript</b> is sent, never the video. Your key <b>stays in this browser</b>.
            </p>
            <Button variant="secondary" size="md" className="w-full" onClick={() => enable("anthropic")} data-use-own-key>
              <KeyRound size={14} /> Use my own key
            </Button>
          </div>
          {note && <p className="rf-read-note rf-ok">{note}</p>}
        </PanelSection>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        title="Reels"
        body={
          <>
            <ol className="rf-read rf-steps" data-reels-steps>
              <li>
                <span>
                  <b>Reads</b> your transcript{" "}
                  <span className="whitespace-nowrap">
                    with <span className="rf-mono">{activeModel(aiSettings)}</span>
                  </span>
                </span>
              </li>
              <li>
                <span>
                  <b>Picks</b> the best moments
                </span>
              </li>
              <li>
                <span>
                  <b>Cuts</b> each into its own {format.ratio} reel, captions included
                </span>
              </li>
            </ol>
            <p className="rf-read-note mt-2.5">Every reel opens and exports on its own.</p>
          </>
        }
      />
      <PanelSection title="Cut reels">
        <div className="grid grid-cols-2 gap-2">
          <Field label="How many">
            <Select value={String(settings.count)} onChange={(e) => updateSettings({ count: Number(e.target.value) as ReelSettings["count"] })} disabled={!!job} aria-label="Number of reels">
              <option value="3">3 reels</option>
              <option value="5">5 reels</option>
              <option value="8">8 reels</option>
              <option value="12">12 reels</option>
            </Select>
          </Field>
          <Field label="Length">
            <Select value={String(settings.targetSeconds)} onChange={(e) => updateSettings({ targetSeconds: Number(e.target.value) as ReelSettings["targetSeconds"] })} disabled={!!job} aria-label="Reel length">
              <option value="15">about 15 s</option>
              <option value="30">about 30 s</option>
              <option value="60">about 60 s</option>
            </Select>
          </Field>
        </div>
        {!job ? (
          <Button variant="primary" className="w-full" onClick={run} disabled={!project.clips.length || !!captionJob} title={hasCues ? "Find the best moments and cut them into reels" : "Needs subtitles first: the model reads the transcript"}>
            <Clapperboard size={14} /> Make reels
          </Button>
        ) : (
          jobBlock
        )}
        {!hasCues && project.clips.length > 0 && (
          needCaptions ? (
            <div className="space-y-2 rounded-lg border border-sys-orange/40 bg-sys-orange/10 p-2.5" role="status" data-reels-need-captions>
              <p className="rf-read flex items-start gap-2">
                <Captions size={15} className="mt-[3px] shrink-0 text-sys-orange" />
                <span>
                  <b>Add subtitles first.</b> The model picks moments by reading the transcript, and this video has none yet.
                </span>
              </p>
              {captionJob ? (
                <div className="space-y-1.5" data-caption-job>
                  <p className="text-[13px] font-semibold text-white">Generating subtitles</p>
                  <p className="text-[12px] leading-snug text-label-2">{captionJob.message}</p>
                  <ProgressBar value={captionJob.progress} />
                  {captionJob.partial && <p className="rf-read-note line-clamp-2 italic">{captionJob.partial}</p>}
                  <Button variant="outline" size="xs" onClick={cancelCaptions}>
                    <Square size={11} /> Cancel
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="primary" size="sm" onClick={() => void doItForMe()} disabled={!!job} data-do-it-for-me title="Generate the subtitles here with the default model, then cut the reels">
                      <Sparkles size={13} /> Do this for me
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => useEditor.getState().setTool("subtitles")} data-open-subtitles>
                      <Captions size={13} /> Open Subtitles
                    </Button>
                  </div>
                  <ul className="rf-read-note space-y-1">
                    <li>
                      <b>Do this for me</b> transcribes on this device, then cuts the reels.
                    </li>
                    <li>
                      <b>Open Subtitles</b> to choose the model, language or speakers first.
                    </li>
                  </ul>
                  {captionError && <p className="whitespace-pre-wrap text-[11px] text-sys-red">{captionError}</p>}
                </>
              )}
            </div>
          ) : (
            <p className="rf-read-note flex items-start gap-2">
              <Captions size={14} className="mt-[2px] shrink-0" />
              <span>
                <b>No captions yet.</b> Make reels needs them: the model reads the transcript to pick the moments.
              </span>
            </p>
          )
        )}
        {error && <p className="whitespace-pre-wrap text-[11px] text-sys-red">{error}</p>}
        {note && <p className="text-[11px] text-sys-green">{note}</p>}
      </PanelSection>
      <PanelSection title="Model">
        <AiModelFields settings={aiSettings} onChange={updateAi} disabled={!!job} permissionHint={permissionHint} models={models} modelsError={modelsError} modelsPending={modelsPending} onRefresh={() => void refreshModels()} />
        <p className="rf-read-note">
          Default: <b>{DEFAULT_REEL_SETTINGS.count} reels</b> of about <b>{DEFAULT_REEL_SETTINGS.targetSeconds} s</b> each.
        </p>
      </PanelSection>
      <PanelSection title={`Reels${reels.length ? ` (${reels.length})` : ""}`}>
        {reels.length === 0 ? (
          <EmptyState icon={<Clapperboard size={20} />} title="No reels yet" description="Press Make reels; each one shows up here and on the start screen. Double-click a reel to edit it, press its thumbnail to preview." />
        ) : (
          reelList()
        )}
      </PanelSection>
      {preview && <ReelPreview reel={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
