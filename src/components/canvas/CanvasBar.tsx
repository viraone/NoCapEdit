"use client";
import { Eye, EyeOff, Grid2x2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { FRAME_FORMATS, getFormat } from "@/lib/models/formats";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

export function CanvasBar() {
  const project = useEditor((s) => s.project)!;
  const canvasZoom = useEditor((s) => s.canvasZoom);
  const setCanvasZoom = useEditor((s) => s.setCanvasZoom);
  const update = useEditor((s) => s.update);
  const platforms = [...new Set(FRAME_FORMATS.map((f) => f.platform))];

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-neutral-800 px-3">
      <Select
        className="h-7 w-56 text-xs"
        value={project.formatId}
        onChange={(e) =>
          update((p) => {
            p.formatId = e.target.value;
            p.safeZone = getFormat(e.target.value).safeZone;
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
      </Select>
      <Select className="h-7 w-24 text-xs" value={String(canvasZoom)} onChange={(e) => setCanvasZoom(e.target.value === "fit" ? "fit" : Number(e.target.value))} aria-label="Canvas zoom">
        <option value="fit">Fit</option>
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
      </Select>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant={project.safeZone !== "none" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => update((p) => void (p.safeZone = p.safeZone === "none" ? getFormat(p.formatId).safeZone === "none" ? "reels" : getFormat(p.formatId).safeZone : "none"))}
          title="Toggle safe-zone overlay"
        >
          <Grid2x2 size={14} /> Safe zone
        </Button>
        <Button variant="ghost" size="sm" onClick={() => update((p) => void (p.captions.visible = !p.captions.visible))} title="Show or hide captions">
          {project.captions.visible ? <Eye size={14} /> : <EyeOff size={14} />} Captions
        </Button>
      </div>
    </div>
  );
}
