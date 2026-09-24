"use client";
import { useRef, useState } from "react";
import { Scissors, ArrowRightToLine, ArrowLeftToLine, Snail, PersonStanding, Rabbit, Zap, SquareSplitHorizontal, Circle, Moon, ZoomOut, ZoomIn, Maximize, Minimize, ChevronDown, Wand2, Square, ScanFace, Undo2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useTargetClip, useSliderTx } from "./shared";
import { layoutClips, findLayout, toSourceTime } from "@/lib/models/timeline";
import { SPEED_MAX, SPEED_MIN, TRANSITIONS, ZOOM_MAX, ZOOM_MIN, type Clip, type TransitionType } from "@/lib/models/project";
import { cutAfter, cutBefore, fitZoom, splitClipAt } from "@/lib/models/clipOps";
import { getFormat } from "@/lib/models/formats";
import { getAsset, putAsset } from "@/lib/storage/db";
import { enhanceAudio, ENHANCE_MODES, type EnhanceMode } from "@/lib/audio/enhance";
import { autoReframe } from "@/lib/tracking/autoReframe";
import { uid } from "@/lib/utils/id";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Tile, TileGrid } from "@/components/ui/Tile";
import { Field } from "@/components/ui/Field";
import { Slider } from "@/components/ui/Slider";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { NumberInput } from "@/components/ui/NumberInput";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";

const SPEEDS: { value: number; label: string; icon: React.ReactNode }[] = [
  { value: 0.5, label: "0.5×", icon: <Snail size={16} /> },
  { value: 1, label: "1×", icon: <PersonStanding size={16} /> },
  { value: 1.5, label: "1.5×", icon: <Rabbit size={16} /> },
  { value: 2, label: "2×", icon: <Zap size={16} /> },
];

const QUICK_TRANSITIONS: { id: TransitionType; label: string; icon: React.ReactNode }[] = [
  { id: "none", label: "Cut", icon: <SquareSplitHorizontal size={16} /> },
  { id: "fade", label: "Dissolve", icon: <Circle size={16} /> },
  { id: "fadeblack", label: "Fade", icon: <Moon size={16} /> },
];

const BACKGROUNDS = ["#000000", "#1c1c1e", "#2f3a4a", "#1d2b53", "#4a1942", "#1f3d2b", "#f1e3c8", "#ffffff"];

export function TrimPanel() {
  const project = useProject();
  const clip = useTargetClip();
  const update = useEditor((s) => s.update);
  const setNotice = useEditor((s) => s.setNotice);
  const tx = useSliderTx();
  const [more, setMore] = useState(false);
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
  const format = getFormat(project.formatId);
  const frame = { width: format.width, height: format.height };
  const layouts = layoutClips(project.clips);
  const layout = findLayout(layouts, clip.id);
  const index = project.clips.findIndex((c) => c.id === clip.id);
  const hasNext = index >= 0 && index < project.clips.length - 1;
  const now = () => useEditor.getState().currentTime;
  const fit = fitZoom({ width: clip.width, height: clip.height }, frame);
  const zoomLabel = `${clip.zoom.toFixed(1)}×`;
  const quickTransition = QUICK_TRANSITIONS.find((t) => t.id === clip.transition.type)?.id ?? null;

  const doSplit = () => {
    let ok = false;
    update((p) => void (ok = splitClipAt(p, now()) !== null));
    setNotice(ok ? "Split the clip at the playhead." : "Move the playhead inside the clip to split it.");
  };
  const doCutBefore = () => {
    let ok = false;
    update((p) => void (ok = cutBefore(p, now())));
    setNotice(ok ? "Removed everything before the playhead." : "Nothing to cut before the playhead.");
  };
  const doCutAfter = () => {
    let ok = false;
    update((p) => void (ok = cutAfter(p, now())));
    setNotice(ok ? "Removed everything after the playhead." : "Nothing to cut after the playhead.");
  };
  const setToPlayhead = (which: "in" | "out") => {
    if (!layout) return;
    const s = toSourceTime(layout, now());
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
      setNotice("Cleaned up the clip audio.");
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
      const keyframes = await autoReframe({ videoUrl: url, clip, frame, signal: controller.signal, onProgress: (message, progress) => setJob({ kind: "reframe", message, progress }) });
      edit((c) => void (c.reframe = { keyframes, label: "Face tracking" }));
      setNotice("The picture now follows the face.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setJobError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  return (
    <>
      <PanelHeader
        title="Trim"
        meta={
          <span className="tabular-nums">
            {clip.name} · {formatTime(clip.duration)}
          </span>
        }
        description="Press Play and stop where you want to cut. Everything here works on the highlighted clip, at the playhead."
      />

      <PanelSection title="Cut at the playhead">
        <TileGrid cols={3}>
          <Tile icon={<Scissors size={16} />} label="Split" onClick={doSplit} />
          <Tile icon={<ArrowRightToLine size={16} />} label="Cut before" onClick={doCutBefore} />
          <Tile icon={<ArrowLeftToLine size={16} />} label="Cut after" onClick={doCutAfter} />
        </TileGrid>
      </PanelSection>

      <PanelSection title={`Speed  ${clip.speed}×`}>
        <TileGrid cols={4}>
          {SPEEDS.map((s) => (
            <Tile key={s.value} icon={s.icon} label={s.label} active={Math.abs(clip.speed - s.value) < 1e-6} onClick={() => edit((c) => void (c.speed = s.value))} />
          ))}
        </TileGrid>
      </PanelSection>

      <PanelSection title="Transition to the next clip">
        <TileGrid cols={3}>
          {QUICK_TRANSITIONS.map((t) => (
            <Tile key={t.id} icon={t.icon} label={t.label} active={quickTransition === t.id} disabled={!hasNext} onClick={() => edit((c) => void (c.transition.type = t.id))} />
          ))}
        </TileGrid>
        {!hasNext && <p className="text-[11px] text-label-3">This is the last clip. Transitions apply between clips.</p>}
      </PanelSection>

      <PanelSection title={`Picture zoom  ${zoomLabel}`}>
        <TileGrid cols={4}>
          <Tile icon={<ZoomOut size={16} />} label="Out" onClick={() => edit((c) => void (c.zoom = Math.max(ZOOM_MIN, Math.round((c.zoom - 0.1) * 10) / 10)))} />
          <Tile icon={<ZoomIn size={16} />} label="In" onClick={() => edit((c) => void (c.zoom = Math.min(ZOOM_MAX, Math.round((c.zoom + 0.1) * 10) / 10)))} />
          <Tile icon={<Maximize size={16} />} label="Fill" active={Math.abs(clip.zoom - 1) < 1e-6} onClick={() => edit((c) => void ((c.zoom = 1), (c.pan = { x: 0, y: 0 })))} />
          <Tile icon={<Minimize size={16} />} label="Fit" active={Math.abs(clip.zoom - fit) < 1e-6} onClick={() => edit((c) => void ((c.zoom = fit), (c.pan = { x: 0, y: 0 })))} />
        </TileGrid>
      </PanelSection>

      <PanelSection title={`Background  ${clip.background === "#000000" ? "Black" : clip.background === "#ffffff" ? "White" : clip.background.toUpperCase()}`}>
        <div className="flex flex-wrap items-center gap-2">
          {BACKGROUNDS.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`Background ${color}`}
              onClick={() => edit((c) => void (c.background = color))}
              className={cx("h-6 w-6 rounded-full border-2 transition-transform hover:scale-110", clip.background.toLowerCase() === color ? "border-sys-blue" : "border-white/20")}
              style={{ background: color }}
            />
          ))}
        </div>
        <p className="text-[12px] leading-snug text-label-2">
          Zoom Out past 1× shrinks the picture and leaves bands above and below in this colour. Posted to the feed, Instagram crops a 9:16 video to 4:5, so bands mostly get cut off.
        </p>
        <p className="text-[12px] leading-snug text-label-2">
          The bars on the timeline are the sound: tall where you&apos;re talking, flat in the gaps — cut in a gap. Click anywhere on the timeline to jump there.
        </p>
      </PanelSection>

      <PanelSection>
        <button type="button" className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-[12px] text-label-2 hover:text-white" onClick={() => setMore((m) => !m)}>
          <span>More options</span>
          <ChevronDown size={14} className={cx("transition-transform", more && "rotate-180")} />
        </button>
      </PanelSection>

      {more && (
        <>
          <PanelSection title="In / out points">
            <div className="grid grid-cols-2 gap-2">
              <Field label="In" right={<button type="button" className="text-sys-blue hover:underline" onClick={() => setToPlayhead("in")}>playhead</button>}>
                <NumberInput value={clip.inPoint} min={0} max={clip.outPoint - 0.1} suffix="s" onCommit={(v) => edit((c) => void (c.inPoint = v))} />
              </Field>
              <Field label="Out" right={<button type="button" className="text-sys-blue hover:underline" onClick={() => setToPlayhead("out")}>playhead</button>}>
                <NumberInput value={clip.outPoint} min={clip.inPoint + 0.1} max={clip.duration} suffix="s" onCommit={(v) => edit((c) => void (c.outPoint = v))} />
              </Field>
            </div>
            <p className="text-[11px] text-label-3">Output length {formatTime((clip.outPoint - clip.inPoint) / clip.speed)}. Drag the block edges on the timeline for fine trimming.</p>
          </PanelSection>
          <PanelSection title="Speed & pitch">
            <Slider label="Playback speed" value={clip.speed} min={SPEED_MIN} max={SPEED_MAX} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => edit((c) => void (c.speed = v), false)} {...tx} />
            <Toggle checked={clip.preservePitch} onChange={(v) => edit((c) => void (c.preservePitch = v))} label="Preserve voice pitch" description="Off shifts the pitch with the speed" />
          </PanelSection>
          <PanelSection title="Framing">
            <Slider label="Crop zoom" value={clip.zoom} min={ZOOM_MIN} max={ZOOM_MAX} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => edit((c) => void (c.zoom = v), false)} {...tx} />
            <Slider label="Pan X" value={clip.pan.x} min={-1} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((c) => void (c.pan.x = v), false)} {...tx} />
            <Slider label="Pan Y" value={clip.pan.y} min={-1} max={1} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((c) => void (c.pan.y = v), false)} {...tx} />
            <p className="text-[11px] text-label-3">With the Trim tool active you can also drag the video in the preview to pan it.</p>
          </PanelSection>
          <PanelSection title="Transition">
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
          </PanelSection>
          <PanelSection title="Audio">
            <Slider label="Clip volume" value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((c) => void (c.volume = v), false)} disabled={!clip.hasAudio} {...tx} />
            {clip.audioAssetId ? (
              <div className="flex items-center justify-between rounded-lg border border-sys-green/40 bg-sys-green/10 px-2 py-1.5 text-[11px] text-sys-green">
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
              <div className="flex items-center justify-between rounded-lg border border-sys-green/40 bg-sys-green/10 px-2 py-1.5 text-[11px] text-sys-green">
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
            <p className="text-[11px] text-label-3">Detects the main face with MediaPipe and animates the pan so it stays centred in the {format.ratio} frame.</p>
            {job && (
              <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
                <ProgressBar value={job.progress} />
                <p className="text-[11px] text-label-2">{job.message}</p>
                <Button variant="outline" size="xs" onClick={() => abortRef.current?.abort()}>
                  <Square size={11} /> Cancel
                </Button>
              </div>
            )}
            {jobError && <p className="text-[11px] text-sys-red">{jobError}</p>}
          </PanelSection>
        </>
      )}
    </>
  );
}
