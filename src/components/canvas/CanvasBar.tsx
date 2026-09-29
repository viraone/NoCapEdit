"use client";
import { useState } from "react";
import { ZoomIn, ZoomOut, Maximize, Minimize, Eye, EyeOff, Smartphone } from "lucide-react";
import { PhonePreview } from "./PhonePreview";
import { useEditor } from "@/store/editorStore";
import { useTargetClip } from "@/components/panels/shared";
import { FRAME_FORMATS, getFormat } from "@/lib/models/formats";
import { ZOOM_MAX, type Clip } from "@/lib/models/project";
import { fitZoom, minZoom } from "@/lib/models/clipOps";
import { CAPTION_PRESETS } from "@/lib/captions/presets";
import { cx } from "@/lib/utils/cx";

/** Pill controls under the preview: format, picture zoom, fill/fit, caption style, safe zone. */
export function CanvasBar() {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const clip = useTargetClip();
  const format = getFormat(project.formatId);
  const platforms = [...new Set(FRAME_FORMATS.map((f) => f.platform))];
  const fit = clip ? fitZoom({ width: clip.width, height: clip.height }, { width: format.width, height: format.height }) : 1;
  const edit = (fn: (c: Clip) => void) =>
    update((p) => {
      const c = p.clips.find((c) => c.id === clip?.id);
      if (c) fn(c);
    });
  const zoom = clip?.zoom ?? 1;
  // A <select> sizes to its longest option; in the monospace UI the selected
  // label's character count gives an exact width instead.
  const chWidth = (label: string) => ({ width: `calc(${label.length}ch + 1.75rem)` });
  const formatLabel = `${format.name} · ${format.ratio}`;
  const presetLabel = CAPTION_PRESETS.find((p) => p.id === project.subtitleStyle.presetId)?.name ?? "";
  const [phone, setPhone] = useState(false);
  const safeOn = project.safeZone !== "none";

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 pb-1">
      <label className="pill cursor-pointer">
        <span className="h-3 w-3 rounded-full bg-[conic-gradient(#ffd60a,#ff375f,#bf5af2,#0a84ff,#ffd60a)]" />
        <select
          className="max-w-72 cursor-pointer appearance-none truncate bg-transparent pr-6 font-semibold focus:outline-none"
          style={chWidth(formatLabel)}
          value={project.formatId}
          onChange={(e) =>
            update((p) => {
              p.formatId = e.target.value;
              // A guide that's showing follows the new format; one that's off stays off.
              if (p.safeZone !== "none") p.safeZone = getFormat(e.target.value).safeZone;
            })
          }
          aria-label="Frame format"
        >
          {platforms.map((platform) => (
            <optgroup key={platform} label={platform}>
              {FRAME_FORMATS.filter((f) => f.platform === platform).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} · {f.ratio}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="-ml-5 text-label-2">⌄</span>
      </label>

      <div className="pill gap-1 px-1.5">
        <button type="button" className="rounded-md p-1 hover:bg-white/10 disabled:opacity-40" disabled={!clip} onClick={() => edit((c) => void (c.zoom = Math.max(minZoom(fit), Math.round((c.zoom - 0.1) * 10) / 10)))} title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <span className="w-10 text-center tabular-nums">{zoom.toFixed(1)}×</span>
        <button type="button" className="rounded-md p-1 hover:bg-white/10 disabled:opacity-40" disabled={!clip} onClick={() => edit((c) => void (c.zoom = Math.min(ZOOM_MAX, Math.round((c.zoom + 0.1) * 10) / 10)))} title="Zoom in">
          <ZoomIn size={14} />
        </button>
      </div>

      <button type="button" className="pill" data-active={clip && Math.abs(zoom - 1) < 1e-6 ? "true" : "false"} disabled={!clip} onClick={() => edit((c) => void ((c.zoom = 1), (c.pan = { x: 0, y: 0 })))}>
        <Maximize size={14} /> Fill
      </button>
      <button type="button" className="pill" data-active={clip && Math.abs(zoom - fit) < 1e-6 ? "true" : "false"} disabled={!clip} onClick={() => edit((c) => void ((c.zoom = fit), (c.pan = { x: 0, y: 0 })))}>
        <Minimize size={14} /> Fit
      </button>

      <label className="pill cursor-pointer">
        <span className="font-bold">Aa</span>
        <select
          className="cursor-pointer appearance-none bg-transparent pr-6 font-semibold focus:outline-none"
          style={chWidth(presetLabel)}
          value={project.subtitleStyle.presetId}
          onChange={(e) => update((p) => void (p.subtitleStyle.presetId = e.target.value))}
          aria-label="Caption style"
        >
          {CAPTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="-ml-5 text-label-2">⌄</span>
      </label>

      <button
        type="button"
        className={cx("pill")}
        data-active={safeOn ? "true" : "false"}
        onClick={() => update((p) => void (p.safeZone = p.safeZone === "none" ? (getFormat(p.formatId).safeZone === "none" ? "reels" : getFormat(p.formatId).safeZone) : "none"))}
        title={safeOn ? "Hide the platform safe zone" : "Show the platform safe zone"}
        aria-pressed={safeOn}
      >
        {safeOn ? <Eye size={14} /> : <EyeOff size={14} />} Safe zone
      </button>

      <button type="button" className="pill" data-active={phone ? "true" : "false"} onClick={() => setPhone(true)} title="See the post on an iPhone 16 Pro Max in the Instagram app" disabled={!clip}>
        <Smartphone size={14} /> Phone
      </button>
      {phone && <PhonePreview onClose={() => setPhone(false)} />}
    </div>
  );
}
