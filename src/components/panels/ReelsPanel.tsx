"use client";
/**
 * Reels: the local model reads the transcript, picks the best moments and each
 * becomes its own reel project (source's frame format, captions carried over).
 * Projects without captions are handed to the Subtitles panel, which generates
 * them first, cuts the reels and comes back here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clapperboard, FolderOpen, Share2, Trash2, Square, Captions, Play } from "lucide-react";
import { ReelPreview } from "./ReelPreview";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { DEFAULT_REEL_SETTINGS, listReels, loadReelSettings, makeReels, saveReelSettings, type ReelSettings } from "@/lib/edit/reelMaker";
import { activeModel, listOllamaModels, loadAiSettings, localAiEnabled, saveAiSettings, type AiSettings } from "@/lib/edit/aiHighlights";
import { AiModelFields } from "./AiModelFields";
import { getFormat } from "@/lib/models/formats";
import { projectDuration } from "@/lib/models/timeline";
import type { VideoProject } from "@/lib/models/project";
import { deleteProject, getProject, getProjectThumb } from "@/lib/storage/db";
import { formatTime, nowMs } from "@/lib/utils/time";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";

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
  const [job, setJob] = useState<{ message: string; progress: number | null; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasCues = project.cues.length > 0;
  const [preview, setPreview] = useState<VideoProject | null>(null);

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
  useEffect(() => {
    if (!job) return;
    const id = setInterval(() => setElapsed(Math.round((nowMs() - job.started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [job]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const run = async () => {
    if (job) return;
    if (!useEditor.getState().project?.cues.length) {
      // Captions first: the Subtitles panel generates them, cuts the reels and returns here.
      useEditor.getState().requestReels();
      return;
    }
    setError(null);
    setNote(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setElapsed(0);
    setJob({ message: "Starting", progress: null, started: nowMs() });
    try {
      const result = await makeReels({
        project: useEditor.getState().project!,
        count: settings.count,
        targetSeconds: settings.targetSeconds,
        settings: aiSettings,
        signal: controller.signal,
        onProgress: (message, progress) => setJob((j) => (j ? { ...j, message, progress } : j)),
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
  // "Make reels" from the project menu lands here when captions already exist.
  const reelsRequest = useEditor((s) => s.reelsRequest);
  const handled = useRef(0);
  useEffect(() => {
    if (!reelsRequest || reelsRequest === handled.current || !hasCues) return;
    handled.current = reelsRequest;
    const id = setTimeout(() => void run(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reelsRequest]);

  /** The reel rows: thumbnail previews here, open in the editor, export, delete. In a reel, the one being edited is marked and a single click opens a sibling. */
  const reelList = () => (
    <ul className="space-y-1.5" data-reel-list>
      {reels.map((r) => {
        const current = isReel && r.id === project.id;
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
            <button type="button" className="group relative h-14 w-9 shrink-0 overflow-hidden rounded bg-sys-gray6" onClick={(e) => (e.stopPropagation(), setPreview(r))} aria-label="Play this reel">
              {thumbs[r.id] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbs[r.id]} alt="" className="h-full w-full object-cover" />
              ) : null}
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-80 group-hover:opacity-100">
                <Play size={14} fill="currentColor" />
              </span>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold">
                {r.reel?.title}
                {current && <span className="ml-1.5 rounded bg-sys-blue px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">Editing</span>}
              </p>
              <p className="text-[11px] tabular-nums text-label-3">
                Reel {r.reel?.index} · {r.reel?.score}/10 · {formatTime(projectDuration(r.clips))} · from {formatTime(r.reel?.start ?? 0)}
              </p>
            </div>
            {!current && (
              <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), router.push(`/editor?id=${r.id}&tool=reels`))} title="Open this reel">
                <FolderOpen size={13} />
              </Button>
            )}
            <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), router.push(`/editor?id=${r.id}&tool=export`))} title="Export this reel">
              <Share2 size={13} />
            </Button>
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
        <PanelHeader title="Reels" description={`You're editing Reel ${project.reel?.index} of ${sourceName ? `"${sourceName}"` : "the source video"}. Click another reel below to switch to it, or go back to the source video to make more.`} />
        <PanelSection>
          <Button variant="primary" size="md" className="w-full" onClick={() => router.push(backHref)} data-all-reels title="Back to the source video and the list of all its reels">
            <ArrowLeft size={14} /> All reels{sourceName ? ` · ${sourceName}` : ""}
          </Button>
          <p className="text-[11px] text-label-3">The source video keeps the full transcript; Make reels there adds to this list. The same link sits at the top of the screen.</p>
        </PanelSection>
        <PanelSection title={`All reels (${reels.length})`}>{reels.length ? reelList() : <p className="text-[11px] text-label-3">Loading…</p>}</PanelSection>
        {preview && <ReelPreview reel={preview} onClose={() => setPreview(null)} />}
      </>
    );
  }

  if (!aiAvailable) {
    return (
      <>
        <PanelHeader title="Reels" description="Reels are cut by a model served by Ollama on your own machine; nothing leaves it." />
        <PanelSection>
          <EmptyState
            icon={<Clapperboard size={20} />}
            title="Uses Ollama on this computer"
            description="Install Ollama, pull a model (ollama pull qwen3.8:27b) and start it with OLLAMA_ORIGINS set to this site's address so the browser may call it. Then enable local AI here."
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  try {
                    localStorage.setItem("reelflow.localAi", "1");
                  } catch {
                    /* storage unavailable */
                  }
                  setAiAvailable(true);
                }}
              >
                Enable local AI in this browser
              </Button>
            }
          />
          <p className="text-[11px] leading-snug text-label-3">
            Terminal, before opening this site: <code className="rounded bg-sys-gray4 px-1">OLLAMA_ORIGINS={typeof location !== "undefined" ? location.origin : "https://nocapedit.com"} ollama serve</code> (or set that variable for the Ollama app).
          </p>
        </PanelSection>
      </>
    );
  }

  return (
    <>
      <PanelHeader title="Reels" description={`${activeModel(aiSettings)} reads the transcript, picks the best moments and cuts each into its own ${format.ratio} reel with captions carried over. Every reel opens and exports on its own.`} />
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
          <Button variant="primary" className="w-full" onClick={run} disabled={!project.clips.length} title={hasCues ? "Find the best moments and cut them into reels" : "Generates captions first, then cuts the reels"}>
            <Clapperboard size={14} /> Make reels
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-reel-job>
            <ProgressBar value={job.progress} />
            <p className="text-[11px] text-label-2">
              {job.message} · {elapsed} s
            </p>
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              <Square size={12} /> Cancel
            </Button>
          </div>
        )}
        {!hasCues && project.clips.length > 0 && (
          <p className="flex items-start gap-1.5 text-[11px] leading-snug text-label-3">
            <Captions size={12} className="mt-0.5 shrink-0" /> No captions yet: pressing Make reels generates them first (the model reads the transcript), then cuts the reels.
          </p>
        )}
        {error && <p className="whitespace-pre-wrap text-[11px] text-sys-red">{error}</p>}
        {note && <p className="text-[11px] text-sys-green">{note}</p>}
      </PanelSection>
      <PanelSection title="Model">
        <AiModelFields settings={aiSettings} onChange={updateAi} disabled={!!job} permissionHint={permissionHint} models={models} modelsError={modelsError} modelsPending={modelsPending} onRefresh={() => void refreshModels()} />
        <p className="text-[11px] text-label-3">Default settings: {DEFAULT_REEL_SETTINGS.count} reels of about {DEFAULT_REEL_SETTINGS.targetSeconds} s.</p>
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
