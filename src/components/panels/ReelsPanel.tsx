"use client";
/**
 * Reels: the local model reads the transcript, picks the best moments and each
 * becomes its own reel project (source's frame format, captions carried over).
 * Projects without captions are handed to the Subtitles panel, which generates
 * them first, cuts the reels and comes back here.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, RefreshCw, FolderOpen, Share2, Trash2, Square, Captions, Play } from "lucide-react";
import { ReelPreview } from "./ReelPreview";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { DEFAULT_REEL_SETTINGS, listReels, loadReelSettings, makeReels, saveReelSettings, type ReelSettings } from "@/lib/edit/reelMaker";
import { listOllamaModels, loadAiSettings, localAiEnabled, saveAiSettings, type AiSettings } from "@/lib/edit/aiHighlights";
import { getFormat } from "@/lib/models/formats";
import { projectDuration } from "@/lib/models/timeline";
import type { VideoProject } from "@/lib/models/project";
import { deleteProject, getProjectThumb } from "@/lib/storage/db";
import { formatTime, nowMs } from "@/lib/utils/time";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";

export function ReelsPanel() {
  const project = useProject();
  const router = useRouter();
  const format = getFormat(project.formatId);
  const [aiAvailable, setAiAvailable] = useState(localAiEnabled);
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [settings, setSettings] = useState<ReelSettings>(loadReelSettings);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
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
    setModelsError(null);
    try {
      setModels(await listOllamaModels(aiSettings.endpoint));
    } catch {
      setModels(null);
      setModelsError("Couldn't list models: is Ollama running?");
    }
  };
  const refreshReels = async () => {
    const list = await listReels(project.id);
    setReels(list);
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
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
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
      <PanelHeader title="Reels" description={`${aiSettings.model} reads the transcript, picks the best moments and cuts each into its own ${format.ratio} reel with captions carried over. Every reel opens and exports on its own.`} />
      <PanelSection title="Cut reels">
        <div className="grid grid-cols-2 gap-2">
          <Field label="How many">
            <Select value={String(settings.count)} onChange={(e) => updateSettings({ count: Number(e.target.value) as ReelSettings["count"] })} disabled={!!job} aria-label="Number of reels">
              <option value="3">3 reels</option>
              <option value="5">5 reels</option>
              <option value="8">8 reels</option>
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
        <div className="grid grid-cols-2 gap-2">
          <Field label="Model" right={<button type="button" className="text-sys-blue hover:underline" onClick={refreshModels} title="Refresh local models"><RefreshCw size={11} className="inline" /> refresh</button>}>
            {models && models.length ? (
              <Select value={aiSettings.model} onChange={(e) => updateAi({ model: e.target.value })} aria-label="Model" disabled={!!job}>
                {(models.includes(aiSettings.model) ? models : [aiSettings.model, ...models]).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input value={aiSettings.model} onChange={(e) => updateAi({ model: e.target.value })} placeholder="qwen3.8:27b" spellCheck={false} disabled={!!job} />
            )}
            {modelsError && <p className="mt-1 text-[11px] text-sys-orange">{modelsError}</p>}
          </Field>
          <Field label="Ollama server">
            <Input value={aiSettings.endpoint} onChange={(e) => updateAi({ endpoint: e.target.value })} placeholder="http://localhost:11434" spellCheck={false} disabled={!!job} />
          </Field>
        </div>
        <p className="text-[11px] text-label-3">Everything runs on this machine; nothing leaves it. Default settings: {DEFAULT_REEL_SETTINGS.count} reels of about {DEFAULT_REEL_SETTINGS.targetSeconds} s.</p>
      </PanelSection>
      <PanelSection title={`Reels${reels.length ? ` (${reels.length})` : ""}`}>
        {reels.length === 0 ? (
          <EmptyState icon={<Clapperboard size={20} />} title="No reels yet" description="Press Make reels; each one shows up here and on the start screen. Double-click a reel to edit it, press its thumbnail to preview." />
        ) : (
          <ul className="space-y-1.5" data-reel-list>
            {reels.map((r) => (
              <li
                key={r.id}
                data-reel={r.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2 select-none hover:border-sys-gray3"
                title="Double-click to open this reel in the editor; press the thumbnail to preview it here"
                onDoubleClick={() => router.push(`/editor?id=${r.id}`)}
              >
                <button type="button" className="group relative h-14 w-9 shrink-0 overflow-hidden rounded bg-sys-gray6" onClick={() => setPreview(r)} aria-label="Play this reel">
                  {thumbs[r.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[r.id]} alt="" className="h-full w-full object-cover" />
                  ) : null}
                  <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-80 group-hover:opacity-100">
                    <Play size={14} fill="currentColor" />
                  </span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12px] font-semibold">{r.reel?.title}</p>
                  <p className="text-[11px] tabular-nums text-label-3">
                    Reel {r.reel?.index} · {r.reel?.score}/10 · {formatTime(projectDuration(r.clips))} · from {formatTime(r.reel?.start ?? 0)}
                  </p>
                </div>
                <Button variant="ghost" size="iconSm" onClick={() => router.push(`/editor?id=${r.id}`)} title="Open this reel">
                  <FolderOpen size={13} />
                </Button>
                <Button variant="ghost" size="iconSm" onClick={() => router.push(`/editor?id=${r.id}&tool=export`)} title="Export this reel">
                  <Share2 size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  className="text-sys-red"
                  title="Delete this reel"
                  onClick={async () => {
                    await deleteProject(r.id);
                    void refreshReels();
                  }}
                >
                  <Trash2 size={13} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {preview && <ReelPreview reel={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
