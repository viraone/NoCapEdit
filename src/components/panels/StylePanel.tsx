"use client";
import { SUBTITLE_SCALE_RANGE } from "@/lib/models/project";
import { useEditor } from "@/store/editorStore";
import { useProject, useSliderTx } from "./shared";
import { CAPTION_PRESETS, PRESET_CATEGORIES, getPreset, type CaptionPreset } from "@/lib/captions/presets";
import { fontFamily } from "@/lib/captions/fonts";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Slider } from "@/components/ui/Slider";
import { Toggle } from "@/components/ui/Toggle";
import { ColorInput } from "@/components/ui/ColorInput";
import { Select } from "@/components/ui/Select";
import { Field } from "@/components/ui/Field";

function previewStyle(p: CaptionPreset): React.CSSProperties {
  const shadows: string[] = [];
  if (p.stroke) {
    const w = 1.5;
    shadows.push(`-${w}px -${w}px 0 ${p.stroke.color}`, `${w}px -${w}px 0 ${p.stroke.color}`, `-${w}px ${w}px 0 ${p.stroke.color}`, `${w}px ${w}px 0 ${p.stroke.color}`);
  }
  if (p.glow) shadows.push(`0 0 8px ${p.glow.color}`);
  if (p.shadow) shadows.push(`${p.shadow.x * 16}px ${p.shadow.y * 16}px ${p.shadow.blur * 16}px ${p.shadow.color}`);
  return {
    fontFamily: fontFamily(p.font),
    fontWeight: p.weight,
    fontStyle: p.italic ? "italic" : "normal",
    color: p.color,
    textTransform: p.uppercase ? "uppercase" : "none",
    letterSpacing: p.letterSpacing ? `${p.letterSpacing}em` : undefined,
    textShadow: shadows.join(", ") || undefined,
    background: p.box?.color,
    borderRadius: p.box ? `${p.box.radius * 10}px` : undefined,
    padding: p.box ? "2px 8px" : "2px 0",
  };
}

export function StylePanel() {
  const project = useProject();
  const update = useEditor((s) => s.update);
  const tx = useSliderTx();
  const style = project.subtitleStyle;
  const preset = getPreset(style.presetId);
  const set = (fn: (s: typeof style) => void, history = true) => update((p) => fn(p.subtitleStyle), { history });

  return (
    <>
      <PanelHeader title="Caption style" description={`${CAPTION_PRESETS.length} presets with a per-word accent highlight. Changes apply to every caption.`} />
      {PRESET_CATEGORIES.map((cat) => (
        <PanelSection key={cat.id} title={cat.name}>
          <div className="grid grid-cols-3 gap-2">
            {CAPTION_PRESETS.filter((p) => p.category === cat.id).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => set((s) => void (s.presetId = p.id))}
                className={cx(
                  "flex h-16 flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border bg-sys-gray4 px-1",
                  style.presetId === p.id ? "border-sys-blue ring-1 ring-sys-blue/60" : "border-sys-gray4 hover:border-sys-gray2",
                )}
                title={p.name}
              >
                <span className="text-[13px] leading-tight" style={previewStyle(p)}>
                  Word <span style={{ color: p.accent }}>up</span>
                </span>
                <span className="text-[10px] text-label-2">{p.name}</span>
              </button>
            ))}
          </div>
        </PanelSection>
      ))}
      <PanelSection title="Adjust">
        <Slider label="Size" value={style.sizeScale} min={SUBTITLE_SCALE_RANGE.min} max={SUBTITLE_SCALE_RANGE.max} step={SUBTITLE_SCALE_RANGE.step} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((s) => void (s.sizeScale = v), false)} {...tx} />
        <Slider label="Vertical position" value={style.y} min={0.05} max={0.95} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((s) => void (s.y = v), false)} {...tx} />
        <Slider label="Max width" value={style.maxWidth} min={0.4} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set((s) => void (s.maxWidth = v), false)} {...tx} />
        <Toggle checked={style.highlight} onChange={(v) => set((s) => void (s.highlight = v))} label="Highlight the spoken word" description={`Preset uses the “${preset.highlight}” highlight`} />
        <Field label="Letter case">
          <Select value={style.uppercase === null ? "preset" : style.uppercase ? "upper" : "normal"} onChange={(e) => set((s) => void (s.uppercase = e.target.value === "preset" ? null : e.target.value === "upper"))}>
            <option value="preset">Preset default</option>
            <option value="upper">UPPERCASE</option>
            <option value="normal">As spoken</option>
          </Select>
        </Field>
        <ColorInput label="Accent colour" value={style.accentColor ?? preset.accent} onChange={(v) => set((s) => void (s.accentColor = v))} onReset={style.accentColor ? () => set((s) => void (s.accentColor = null)) : undefined} />
        <ColorInput label="Text colour" value={style.textColor ?? preset.color} onChange={(v) => set((s) => void (s.textColor = v))} onReset={style.textColor ? () => set((s) => void (s.textColor = null)) : undefined} />
        <Toggle checked={style.emoji ?? preset.emoji ?? false} onChange={(v) => set((s) => void (s.emoji = v))} label="Auto emoji" description="Appends an emoji to keywords like money, fire, idea" />
        <Toggle checked={style.speakerColors} onChange={(v) => set((s) => void (s.speakerColors = v))} label="Colour captions by speaker" description={project.cues.some((c) => c.speaker !== undefined) ? "Speakers were detected in this project" : "Run “Identify speakers” in Subtitles first"} />
        <Toggle checked={project.captions.visible} onChange={(v) => update((p) => void (p.captions.visible = v))} label="Show captions" />
      </PanelSection>
    </>
  );
}
