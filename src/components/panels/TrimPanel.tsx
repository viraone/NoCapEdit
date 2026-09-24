"use client";
import { useRef, useState } from "react";
import { RotateCcw, Wand2, Square, ScanFace, Undo2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useTargetClip, useSliderTx } from "./shared";
import { layoutClips, findLayout, toSourceTime } from "@/lib/models/timeline";
import { SPEED_MAX, SPEED_MIN, TRANSITIONS, ZOOM_MAX, ZOOM_MIN, type Clip, type TransitionType } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { getAsset, putAsset } from "@/lib/storage/db";
import { enhanceAudio, ENHANCE_MODES, type EnhanceMode } from "@/lib/audio/enhance";
import { autoReframe } from "@/lib/tracking/autoReframe";
import { uid } from "@/lib/utils/id";
import { formatTime } from "@/lib/utils/time";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Field } from "@/components/ui/Field";
import { Slider } from "@/components/ui/Slider";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { NumberInput } from "@/components/ui/NumberInput";
import { Button } from "@/components/ui/Button";

export function TrimPanel() {
  const project = useProject();
  const clip = useTargetClip();
  const update = useEditor((s) => s.update);
  const tx = useSliderTx();
  const [enhanceMode, setEnhanceMode] = useState<EnhanceMode>("rnnoise");
  const [job, setJob] = useState<{ kind: "enhance" | "reframe"; message: string; progress: number | null } | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  if (!clip) {
    return (
      <>
        <PanelHeader title="Trim" />
        <PanelSection>
          <EmptyState title="No clip to trim" description="Import a clip first, then select it on the timeline." />
        </PanelSection>
      </>
    );
  }

  const edit = (fn: (c: Clip) => void, history = true) =>
    update(
      (p) => {
        const c = p.clips.find((c) => c.id === clip.id);
        if (c) fn(c);
      },
      { history },
    );
  const layouts = layoutClips(project.clips);
  const layout = findLayout(layouts, clip.id);
  const index = project.clips.findIndex((c) => c.id === clip.id);
  const hasNext = index >= 0 && index < project.clips.length - 1;
  const setToPlayhead = (which: "in" | "out") => {
    if (!layout) return;
    const t = useEditor.getState().currentTime;
    const s = toSourceTime(layout, t);
    edit((c) => {
      if (which === "in") c.inPoint = Math.min(s, c.outPoint - 0.1);
      else c.outPoint = Math.max(s, c.inPoint + 0.1);
    });
  };

  const runEnhance = async () => {
    setJobError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ kind: "enhance", message: "Starting", progress: null });
    try {
      const asset = await getAsset(clip.assetId);
      if (!asset) throw new Error("Source file is missing.");
      const { blob } = await enhanceAudio(asset.blob, { mode: enhanceMode, signal: controller.signal, onProgress: (message, progress) => setJob({ kind: "enhance", message, progress }) });
      const id = uid("asset");
      await putAsset({ id, projectId: project.id, name: `${clip.name} (clean).wav`, type: "audio/wav", size: blob.size, blob, createdAt: Date.now() });
      useEditor.getState().registerAsset(id, blob);
      edit((c) => {
        c.audioAssetId = id;
        c.audioLabel = ENHANCE_MODES.find((m) => m.id === enhanceMode)?.label ?? "Enhanced";
        c.hasAudio = true;
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setJobError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const runReframe = async () => {
    setJobError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ kind: "reframe", message: "Starting", progress: null });
    try {
      const url = useEditor.getState().assetUrls[clip.assetId];
      if (!url) throw new Error("Source file is not loaded.");
      const format = getFormat(project.formatId);
      const keyframes = await autoReframe({ videoUrl: url, clip, frame: { width: format.width, height: format.height }, signal: controller.signal, onProgress: (message, progress) => setJob({ kind: "reframe", message, progress }) });
      edit((c) => void (c.reframe = { keyframes, label: "Face tracking" }));
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setJobError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const cancelJob = () => abortRef.current?.abort();

  return (
    <>
      <PanelHeader
        title="Trim"
        description={`${clip.name} · source ${formatTime(clip.duration)}`}
        actions={
          <Button
            variant="ghost"
            size="xs"
            onClick={() =>
              edit((c) => {
                c.inPoint = 0;
                c.outPoint = c.duration;
                c.speed = 1;
                c.zoom = 1;
                c.pan = { x: 0, y: 0 };
                c.volume = 1;
              })
            }
          >
            <RotateCcw size={12} /> Reset
          </Button>
        }
      />
      <PanelSection title="In / out points">
        <div className="grid grid-cols-2 gap-2">
          <Field label="In" right={<button type="button" className="text-brand-300 hover:underline" onClick={() => setToPlayhead("in")}>set to playhead</button>}>
            <NumberInput value={clip.inPoint} min={0} max={clip.outPoint - 0.1} suffix="s" onCommit={(v) => edit((c) => void (c.inPoint = v))} />
          </Field>
          <Field label="Out" right={<button type="button" className="text-brand-300 hover:underline" onClick={() => setToPlayhead("out")}>set to playhead</button>}>
            <NumberInput value={clip.outPoint} min={clip.inPoint + 0.1} max={clip.duration} suffix="s" onCommit={(v) => edit((c) => void (c.outPoint = v))} />
          </Field>
        </div>
        <p className="text-[11px] text-neutral-500">Output length {formatTime((clip.outPoint - clip.inPoint) / clip.speed)}. Drag the block edges on the timeline for fine trimming.</p>
      </PanelSection>
      <PanelSection title="Speed">
        <Slider label="Playback speed" value={clip.speed} min={SPEED_MIN} max={SPEED_MAX} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => edit((c) => void (c.speed = v), false)} {...tx} />
        <div className="flex flex-wrap gap-1">
          {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((s) => (
            <Button key={s} variant={clip.speed === s ? "primary" : "outline"} size="xs" onClick={() => edit((c) => void (c.speed = s))}>
              {s}×
            </Button>
          ))}
        </div>
        <Toggle checked={clip.preservePitch} onChange={(v) => edit((c) => void (c.preservePitch = v))} label="Preserve voice pitch" description="Off shifts the pitch with the speed (asetrate)" />
      </PanelSection>
      <PanelSection title="Framing">
        <Slider label="Crop zoom" value={clip.zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => edit((c) => void (c.zoom = v), false)} {...tx} />
        <Slider label="Pan X" value={clip.pan.x} min={-1} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((c) => void (c.pan.x = v), false)} {...tx} />
        <Slider label="Pan Y" value={clip.pan.y} min={-1} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((c) => void (c.pan.y = v), false)} {...tx} />
        <p className="text-[11px] text-neutral-500">Tip: with the Trim tool active you can drag the video in the preview to pan it.</p>
      </PanelSection>
      <PanelSection title="Audio">
        <Slider label="Clip volume" value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((c) => void (c.volume = v), false)} disabled={!clip.hasAudio} {...tx} />
        {!clip.hasAudio && <p className="text-[11px] text-neutral-500">This clip has no audio track.</p>}
        {clip.audioAssetId ? (
          <div className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-emerald-200">
            <span>Using cleaned audio ({clip.audioLabel ?? "enhanced"})</span>
            <Button variant="ghost" size="xs" onClick={() => edit((c) => void ((c.audioAssetId = null), (c.audioLabel = null)))}>
              <Undo2 size={11} /> Original
            </Button>
          </div>
        ) : (
          <>
            <Field label="Noise removal" hint="Runs ffmpeg's RNNoise / spectral denoisers on this device and swaps in the cleaned track.">
              <Select value={enhanceMode} onChange={(e) => setEnhanceMode(e.target.value as EnhanceMode)} disabled={!!job}>
                {ENHANCE_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </Select>
            </Field>
            {job?.kind !== "enhance" && (
              <Button variant="secondary" size="sm" className="w-full" onClick={runEnhance} disabled={!!job || !clip.hasAudio}>
                <Wand2 size={13} /> Clean up audio
              </Button>
            )}
          </>
        )}
      </PanelSection>
      <PanelSection title="Auto-reframe">
        {clip.reframe ? (
          <div className="flex items-center justify-between rounded-md border border-emerald-500/40 bg-emerald-500/5 px-2 py-1.5 text-[11px] text-emerald-200">
            <span>Following the subject ({clip.reframe.keyframes.length} keyframes)</span>
            <Button variant="ghost" size="xs" onClick={() => edit((c) => void (c.reframe = null))}>
              <Undo2 size={11} /> Static
            </Button>
          </div>
        ) : (
          job?.kind !== "reframe" && (
            <Button variant="secondary" size="sm" className="w-full" onClick={runReframe} disabled={!!job}>
              <ScanFace size={13} /> Follow the face automatically
            </Button>
          )
        )}
        <p className="text-[11px] text-neutral-500">Detects the main face with MediaPipe and animates the pan so it stays centred in the {getFormat(project.formatId).ratio} frame. Works best with the crop zoom above 1×.</p>
        {job && (
          <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
            <ProgressBar value={job.progress} />
            <p className="text-[11px] text-neutral-300">{job.message}</p>
            <Button variant="outline" size="xs" onClick={cancelJob}>
              <Square size={11} /> Cancel
            </Button>
          </div>
        )}
        {jobError && <p className="text-[11px] text-red-400">{jobError}</p>}
      </PanelSection>
      <PanelSection title="Transition to next clip">
        <Field label="Type">
          <Select value={clip.transition.type} onChange={(e) => edit((c) => void (c.transition.type = e.target.value as TransitionType))} disabled={!hasNext}>
            {TRANSITIONS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        </Field>
        <Slider label="Duration" value={clip.transition.duration} min={0.2} max={2} step={0.05} format={(v) => `${v.toFixed(2)} s`} onChange={(v) => edit((c) => void (c.transition.duration = v), false)} disabled={!hasNext || clip.transition.type === "none"} {...tx} />
        {!hasNext && <p className="text-[11px] text-neutral-500">This is the last clip. Transitions apply between clips.</p>}
      </PanelSection>
    </>
  );
}
