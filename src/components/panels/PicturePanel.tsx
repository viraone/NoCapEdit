"use client";
import { useRef, useState } from "react";
import { Upload, Trash2, Image as ImageIcon, Sparkles, Square, Clapperboard } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useSliderTx } from "./shared";
import { createImageOverlay, createLottieOverlay, type ImageOverlay, type LottieOverlay } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { importImage } from "@/lib/media/import";
import { removeImageBackground } from "@/lib/matte/matte";
import { ensureLottie } from "@/lib/lottie/registry";
import { getAsset, putAsset } from "@/lib/storage/db";
import { uid } from "@/lib/utils/id";
import { Toggle } from "@/components/ui/Toggle";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatTime, nowMs } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { FileDrop } from "@/components/ui/FileDrop";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Slider } from "@/components/ui/Slider";
import { NumberInput } from "@/components/ui/NumberInput";
import { TrackControls } from "./TrackControls";

export function PicturePanel() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const assetUrls = useEditor((s) => s.assetUrls);
  const { update, select, seek, registerAsset } = useEditor.getState();
  const tx = useSliderTx();
  const [error, setError] = useState<string | null>(null);
  const images = project.overlays.filter((o): o is ImageOverlay | LottieOverlay => o.kind === "image" || o.kind === "lottie");
  const selected = selection?.kind === "overlay" ? images.find((i) => i.id === selection.id) ?? null : null;
  const duration = projectDuration(project.clips);
  const lottieInputRef = useRef<HTMLInputElement>(null);
  const [bgJob, setBgJob] = useState<{ message: string; progress: number | null } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLottie = async (file: File) => {
    setError(null);
    try {
      const assetId = uid("asset");
      await putAsset({ id: assetId, projectId: project.id, name: file.name, type: file.type || (file.name.endsWith(".json") ? "application/json" : "application/zip"), size: file.size, blob: file, createdAt: nowMs() });
      const entry = await ensureLottie(assetId);
      if (entry.error) throw new Error(entry.error);
      const t = useEditor.getState().currentTime;
      const len = entry.duration > 0.2 ? entry.duration : 3;
      const ov = createLottieOverlay({ assetId, name: file.name.replace(/\.(lottie|json)$/i, "") }, t, Math.min(duration || t + len, t + Math.max(len, 1.5)));
      if (ov.end <= ov.start) ov.end = ov.start + len;
      update((p) => void p.overlays.push(ov));
      select({ kind: "overlay", id: ov.id });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const removeBackground = async () => {
    if (!selected || selected.kind !== "image") return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setBgJob({ message: "Starting", progress: null });
    try {
      const asset = await getAsset(selected.assetId);
      if (!asset) throw new Error("Image is missing");
      const png = await removeImageBackground(asset.blob, (p) => setBgJob({ message: p.message, progress: p.progress }), controller.signal);
      const id = uid("asset");
      await putAsset({ id, projectId: project.id, name: `${selected.name} (cut-out).png`, type: "image/png", size: png.size, blob: png, createdAt: nowMs() });
      registerAsset(id, png);
      update((p) => {
        const o = p.overlays.find((o) => o.id === selected.id);
        if (o && o.kind === "image") o.assetId = id;
      });
      useEditor.getState().setNotice("Removed the background from the sticker.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setBgJob(null);
    }
  };

  const onFiles = async (files: File[]) => {
    setError(null);
    for (const file of files) {
      try {
        const { assetId, aspect, name, blob } = await importImage(file, project.id);
        registerAsset(assetId, blob);
        const t = useEditor.getState().currentTime;
        const end = duration > t + 0.5 ? Math.min(duration, t + 4) : t + 4;
        const ov = createImageOverlay({ assetId, name, aspect }, t, end);
        update((p) => void p.overlays.push(ov));
        select({ kind: "overlay", id: ov.id });
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };
  const edit = (fn: (o: ImageOverlay | LottieOverlay) => void, history = true) =>
    update(
      (p) => {
        const o = p.overlays.find((o) => o.id === selected?.id);
        if (o && (o.kind === "image" || o.kind === "lottie")) fn(o);
      },
      { history },
    );
  const remove = (id: string) => {
    update((p) => void (p.overlays = p.overlays.filter((o) => o.id !== id)));
    if (selection?.id === id) select(null);
  };

  return (
    <>
      <PanelHeader title="Picture" description="Stickers, logos and images. Drag to place, use the corner handle to resize." />
      <PanelSection>
        <FileDrop accept="image/*" multiple onFiles={onFiles} disabled={!project.clips.length} className="flex flex-col items-center gap-1.5">
          <Upload size={18} className="text-label-3" />
          <span className="text-sm">Add images</span>
          <span className="text-[11px] text-label-3">PNG, JPG, WebP, GIF (first frame)</span>
        </FileDrop>
        <input ref={lottieInputRef} type="file" accept=".lottie,.json,application/json" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) addLottie(f);
        }} />
        <Button variant="secondary" size="sm" className="w-full" onClick={() => lottieInputRef.current?.click()} disabled={!project.clips.length} title="Animated lower thirds, stickers and motion graphics (.lottie or Lottie .json)">
          <Clapperboard size={13} /> Add a Lottie animation
        </Button>
        {error && <p className="text-[11px] text-sys-red">{error}</p>}
      </PanelSection>
      <PanelSection title="Stickers & animations">
        {images.length === 0 ? (
          <EmptyState icon={<ImageIcon size={20} />} title="No images yet" />
        ) : (
          <ul className="space-y-1">
            {images.map((img) => (
              <li key={img.id}>
                <button
                  type="button"
                  onClick={() => {
                    select({ kind: "overlay", id: img.id });
                    seek(img.start);
                  }}
                  className={cx("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left", selected?.id === img.id ? "border-sys-blue bg-sys-blue/10" : "border-sys-gray4 hover:border-sys-gray3")}
                >
                  {img.kind === "image" && assetUrls[img.assetId] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrls[img.assetId]} alt="" className="h-8 w-8 rounded bg-sys-gray4 object-contain" />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded bg-sys-gray4 text-sys-teal">
                      <Clapperboard size={14} />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{img.name}</span>
                  <span className="text-[10px] tabular-nums text-label-3">
                    {formatTime(img.start)}–{formatTime(img.end)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {selected && (
        <>
          <PanelSection title="Appearance" right={<Button variant="ghost" size="iconSm" className="text-sys-red" onClick={() => remove(selected.id)} title="Delete"><Trash2 size={13} /></Button>}>
            <Slider label="Size" value={selected.width} min={0.05} max={1.5} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((o) => void (o.width = v), false)} {...tx} />
            <Slider label="Opacity" value={selected.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((o) => void (o.opacity = v), false)} {...tx} />
            <Slider label="Rotation" value={selected.rotation} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => edit((o) => void (o.rotation = v), false)} {...tx} />
            {selected.kind === "lottie" && (
              <>
                <Toggle checked={selected.loop} onChange={(v) => edit((o) => void ((o as LottieOverlay).loop = v))} label="Loop" />
                <Slider label="Speed" value={selected.speed} min={0.25} max={3} step={0.05} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => edit((o) => void ((o as LottieOverlay).speed = v), false)} {...tx} />
              </>
            )}
            <Toggle checked={selected.layer === "behind"} onChange={(v) => edit((o) => void (o.layer = v ? "behind" : "front"))} label="Behind the subject" description="Needs a subject cut-out on the clip (Trim → Subject cut-out)" />
            {selected.kind === "image" &&
              (bgJob ? (
                <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
                  <ProgressBar value={bgJob.progress} />
                  <p className="text-[11px] text-label-2">{bgJob.message}</p>
                  <Button variant="outline" size="xs" onClick={() => abortRef.current?.abort()}>
                    <Square size={11} /> Cancel
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" size="sm" className="w-full" onClick={removeBackground} title="RMBG-1.4 on this device; the first run downloads the model (~45 MB)">
                  <Sparkles size={13} /> Remove background
                </Button>
              ))}
          </PanelSection>
          <PanelSection title="Timing">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start" right={<button type="button" className="text-sys-blue hover:underline" onClick={() => edit((o) => void (o.start = Math.min(useEditor.getState().currentTime, o.end - 0.1)))}>playhead</button>}>
                <NumberInput value={selected.start} min={0} max={selected.end - 0.1} suffix="s" onCommit={(v) => edit((o) => void (o.start = v))} />
              </Field>
              <Field label="End" right={<button type="button" className="text-sys-blue hover:underline" onClick={() => edit((o) => void (o.end = Math.max(useEditor.getState().currentTime, o.start + 0.1)))}>playhead</button>}>
                <NumberInput value={selected.end} min={selected.start + 0.1} suffix="s" onCommit={(v) => edit((o) => void (o.end = v))} />
              </Field>
            </div>
          </PanelSection>
          <PanelSection title="Motion tracking">
            <TrackControls overlay={selected} />
          </PanelSection>
        </>
      )}
    </>
  );
}
