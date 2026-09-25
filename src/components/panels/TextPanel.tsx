"use client";
import { useEffect, useRef } from "react";
import { Plus, Trash2, Type, AlignLeft, AlignCenter, AlignRight, Bold, Italic } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useSliderTx } from "./shared";
import { TEXT_FONT_SIZE_RANGE, createTextOverlay, type FontKey, type TextOverlay, type TextAnimation } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { FONT_KEYS, FONT_LABELS, fontFamily } from "@/lib/captions/fonts";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, textareaClass } from "@/components/ui/Field";
import { Slider } from "@/components/ui/Slider";
import { Select } from "@/components/ui/Select";
import { ColorInput } from "@/components/ui/ColorInput";
import { NumberInput } from "@/components/ui/NumberInput";
import { Toggle } from "@/components/ui/Toggle";
import { TrackControls } from "./TrackControls";

export function TextPanel() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const { update, select, seek } = useEditor.getState();
  const tx = useSliderTx();
  const duration = projectDuration(project.clips);
  const texts = project.overlays.filter((o): o is TextOverlay => o.kind === "text");
  const selected = selection?.kind === "overlay" ? texts.find((t) => t.id === selection.id) ?? null : null;
  const editRequest = useEditor((s) => s.editRequest);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const selectedId = selected?.id ?? null;
  const textTx = useRef(false);
  const closeTextTx = () => {
    if (!textTx.current) return;
    textTx.current = false;
    tx.onDragEnd();
  };
  // A selection change or unmount that skips the blur must not leave the transaction open.
  useEffect(() => closeTextTx, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Double-click on the canvas: put the caret in the text with everything selected.
  useEffect(() => {
    if (!editRequest || editRequest.kind !== "overlay" || editRequest.id !== selectedId) return;
    const el = textRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [editRequest, selectedId]);

  const add = (variant: "title" | "banner") => {
    const t = useEditor.getState().currentTime;
    const ov = createTextOverlay(variant, t, Math.min(duration || t + 3, t + 3));
    if (ov.end <= ov.start) ov.end = ov.start + 3;
    update((p) => void p.overlays.push(ov));
    select({ kind: "overlay", id: ov.id });
  };
  const edit = (fn: (o: TextOverlay) => void, history = true) =>
    update(
      (p) => {
        const o = p.overlays.find((o) => o.id === selected?.id);
        if (o && o.kind === "text") fn(o);
      },
      { history },
    );
  const remove = (id: string) => {
    update((p) => void (p.overlays = p.overlays.filter((o) => o.id !== id)));
    if (selection?.id === id) select(null);
  };

  return (
    <>
      <PanelHeader title="Text" description="Titles and banners. Drag them on the preview; double-click to edit." />
      <PanelSection>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => add("title")} disabled={!project.clips.length}>
            <Plus size={14} /> Title
          </Button>
          <Button variant="secondary" onClick={() => add("banner")} disabled={!project.clips.length}>
            <Plus size={14} /> Banner
          </Button>
        </div>
      </PanelSection>
      <PanelSection title="Layers">
        {texts.length === 0 ? (
          <EmptyState icon={<Type size={20} />} title="No text yet" description="Add a title or banner at the playhead." />
        ) : (
          <ul className="space-y-1">
            {texts.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    select({ kind: "overlay", id: t.id });
                    seek(t.start);
                  }}
                  className={cx("flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left", selected?.id === t.id ? "border-sys-blue bg-sys-blue/10" : "border-sys-gray4 hover:border-sys-gray3")}
                >
                  <span className="rounded bg-sys-gray4 px-1 text-[10px] uppercase text-label-2">{t.variant}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.text}</span>
                  <span className="text-[10px] tabular-nums text-label-3">
                    {formatTime(t.start)}–{formatTime(t.end)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {selected && (
        <>
          <PanelSection title="Content" right={<Button variant="ghost" size="iconSm" className="text-sys-red" onClick={() => remove(selected.id)} title="Delete"><Trash2 size={13} /></Button>}>
            <textarea
              ref={textRef}
              data-content-editor="text"
              className={textareaClass}
              value={selected.text}
              onChange={(e) => edit((o) => void (o.text = e.target.value), false)}
              // Typing is one undo step: the transaction opens on focus and
              // closes on blur (nothing is recorded when the text is unchanged).
              onFocus={() => void (textTx.current = tx.onDragStart() !== false)}
              onBlur={closeTextTx}
              rows={2}
            />
            <Field label="Font">
              <Select value={selected.fontFamily} onChange={(e) => edit((o) => void (o.fontFamily = e.target.value as FontKey))} style={{ fontFamily: fontFamily(selected.fontFamily) }}>
                {FONT_KEYS.map((k) => (
                  <option key={k} value={k} style={{ fontFamily: fontFamily(k) }}>
                    {FONT_LABELS[k]}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center gap-1">
              <Button variant={selected.bold ? "primary" : "outline"} size="iconSm" onClick={() => edit((o) => void (o.bold = !o.bold))} title="Bold"><Bold size={13} /></Button>
              <Button variant={selected.italic ? "primary" : "outline"} size="iconSm" onClick={() => edit((o) => void (o.italic = !o.italic))} title="Italic"><Italic size={13} /></Button>
              <span className="mx-1 h-5 w-px bg-sys-gray4" />
              {(["left", "center", "right"] as const).map((a) => {
                const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
                return (
                  <Button key={a} variant={selected.align === a ? "primary" : "outline"} size="iconSm" onClick={() => edit((o) => void (o.align = a))} title={`Align ${a}`}>
                    <Icon size={13} />
                  </Button>
                );
              })}
            </div>
            <Slider label="Size" value={selected.fontSize} min={TEXT_FONT_SIZE_RANGE.min} max={TEXT_FONT_SIZE_RANGE.max} step={TEXT_FONT_SIZE_RANGE.step} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(v) => edit((o) => void (o.fontSize = v), false)} {...tx} />
            {selected.variant === "title" && <Slider label="Max width" value={selected.maxWidth} min={0.3} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((o) => void (o.maxWidth = v), false)} {...tx} />}
            <ColorInput label="Text colour" value={selected.color} onChange={(v) => edit((o) => void (o.color = v))} />
            <Toggle checked={!!selected.background} onChange={(v) => edit((o) => void (o.background = v ? "#ef4444" : null))} label="Background" />
            {selected.background && <ColorInput label="Background colour" value={selected.background} onChange={(v) => edit((o) => void (o.background = v))} />}
            <Field label="Entrance animation" hint="Animated text exports through the frame-by-frame compositor.">
              <Select value={selected.animation ?? "none"} onChange={(e) => edit((o) => void (o.animation = e.target.value as TextAnimation))}>
                <option value="none">None</option>
                <option value="pop">Pop in</option>
                <option value="typewriter">Typewriter</option>
                <option value="slide">Slide up</option>
                <option value="bounce">Bounce</option>
              </Select>
            </Field>
            <Toggle checked={selected.layer === "behind"} onChange={(v) => edit((o) => void (o.layer = v ? "behind" : "front"))} label="Behind the subject" description="Needs a subject cut-out on the clip (Trim → Subject cut-out)" />
            <Slider label="Opacity" value={selected.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((o) => void (o.opacity = v), false)} {...tx} />
            <Slider label="Rotation" value={selected.rotation} min={-45} max={45} step={0.5} format={(v) => `${v.toFixed(1)}°`} onChange={(v) => edit((o) => void (o.rotation = v), false)} {...tx} />
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
