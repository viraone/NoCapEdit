"use client";
import { useState } from "react";
import { Upload, Trash2, Image as ImageIcon } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useSliderTx } from "./shared";
import { createImageOverlay, type ImageOverlay } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { importImage } from "@/lib/media/import";
import { formatTime } from "@/lib/utils/time";
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
  const images = project.overlays.filter((o): o is ImageOverlay => o.kind === "image");
  const selected = selection?.kind === "overlay" ? images.find((i) => i.id === selection.id) ?? null : null;
  const duration = projectDuration(project.clips);

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
  const edit = (fn: (o: ImageOverlay) => void, history = true) =>
    update(
      (p) => {
        const o = p.overlays.find((o) => o.id === selected?.id);
        if (o && o.kind === "image") fn(o);
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
          <Upload size={18} className="text-neutral-500" />
          <span className="text-sm">Add images</span>
          <span className="text-[11px] text-neutral-500">PNG, JPG, WebP, GIF (first frame)</span>
        </FileDrop>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </PanelSection>
      <PanelSection title="Stickers">
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
                  className={cx("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left", selected?.id === img.id ? "border-brand-500/70 bg-brand-500/5" : "border-neutral-800 hover:border-neutral-700")}
                >
                  {assetUrls[img.assetId] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={assetUrls[img.assetId]} alt="" className="h-8 w-8 rounded bg-neutral-800 object-contain" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm">{img.name}</span>
                  <span className="text-[10px] tabular-nums text-neutral-500">
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
          <PanelSection title="Appearance" right={<Button variant="ghost" size="iconSm" className="text-red-300" onClick={() => remove(selected.id)} title="Delete"><Trash2 size={13} /></Button>}>
            <Slider label="Size" value={selected.width} min={0.05} max={1.5} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((o) => void (o.width = v), false)} {...tx} />
            <Slider label="Opacity" value={selected.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((o) => void (o.opacity = v), false)} {...tx} />
            <Slider label="Rotation" value={selected.rotation} min={-180} max={180} step={1} format={(v) => `${v.toFixed(0)}°`} onChange={(v) => edit((o) => void (o.rotation = v), false)} {...tx} />
          </PanelSection>
          <PanelSection title="Timing">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start" right={<button type="button" className="text-brand-300 hover:underline" onClick={() => edit((o) => void (o.start = Math.min(useEditor.getState().currentTime, o.end - 0.1)))}>playhead</button>}>
                <NumberInput value={selected.start} min={0} max={selected.end - 0.1} suffix="s" onCommit={(v) => edit((o) => void (o.start = v))} />
              </Field>
              <Field label="End" right={<button type="button" className="text-brand-300 hover:underline" onClick={() => edit((o) => void (o.end = Math.max(useEditor.getState().currentTime, o.start + 0.1)))}>playhead</button>}>
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
