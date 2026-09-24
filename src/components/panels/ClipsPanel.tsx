"use client";
import { useState } from "react";
import { Upload, ArrowUp, ArrowDown, Scissors, Copy, Trash2, Film, Broom } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";
import { deleteAsset, listProjectAssets } from "@/lib/storage/db";
import { uid } from "@/lib/utils/id";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { FileDrop } from "@/components/ui/FileDrop";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StockSection } from "./StockSection";

export function ClipsPanel() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const { update, select, seek, setTool, registerAsset } = useEditor.getState();
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: File[]) => {
    setError(null);
    for (const [i, file] of files.entries()) {
      try {
        const { clip, assetId, blob } = await importVideo(file, project.id, (s) => setStatus(`${s} (${i + 1}/${files.length})`));
        registerAsset(assetId, blob);
        const isFirst = useEditor.getState().project?.clips.length === 0;
        update((p) => void p.clips.push(clip));
        if (isFirst) updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setStatus(null);
  };

  const move = (id: string, dir: -1 | 1) =>
    update((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.clips.length) return;
      [p.clips[i], p.clips[j]] = [p.clips[j], p.clips[i]];
    });

  const splitAtPlayhead = () => {
    const t = useEditor.getState().currentTime;
    const loc = locateFrame(layoutClips(project.clips), t);
    if (!loc) return;
    const layout = loc.primary;
    if (t <= layout.start + 0.1 || t >= layout.end - 0.1) return;
    const s = toSourceTime(layout, t);
    update((p) => {
      const i = p.clips.findIndex((c) => c.id === layout.clip.id);
      if (i < 0) return;
      const a = p.clips[i];
      const b = { ...structuredClone(a), id: uid("clip"), inPoint: s };
      a.outPoint = s;
      a.transition = { type: "none", duration: a.transition.duration };
      p.clips.splice(i + 1, 0, b);
    });
  };

  const duplicate = (id: string) =>
    update((p) => {
      const i = p.clips.findIndex((c) => c.id === id);
      if (i >= 0) p.clips.splice(i + 1, 0, { ...structuredClone(p.clips[i]), id: uid("clip") });
    });

  const remove = (id: string) => {
    update((p) => void (p.clips = p.clips.filter((c) => c.id !== id)));
    if (selection?.id === id) select(null);
  };

  const cleanup = async () => {
    const used = new Set<string>([...project.clips.map((c) => c.assetId), ...project.overlays.filter((o) => o.kind === "image").map((o) => (o as { assetId: string }).assetId), ...(project.music ? [project.music.assetId] : [])]);
    const assets = await listProjectAssets(project.id);
    let n = 0;
    for (const a of assets) {
      if (!used.has(a.id)) {
        await deleteAsset(a.id);
        useEditor.getState().releaseAsset(a.id);
        n++;
      }
    }
    useEditor.setState({ past: [], future: [] });
    setStatus(n ? `Removed ${n} unused file${n === 1 ? "" : "s"}` : "Nothing to clean up");
    setTimeout(() => setStatus(null), 2500);
  };

  const layouts = layoutClips(project.clips);

  return (
    <>
      <PanelHeader title="Clips" description="Import recordings, order them and split at the playhead." />
      <PanelSection>
        <FileDrop accept="video/*" multiple onFiles={onFiles} disabled={!!status} className="flex flex-col items-center gap-1.5">
          <Upload size={18} className="text-neutral-500" />
          <span className="text-sm">Add video files</span>
          <span className="text-[11px] text-neutral-500">Drag & drop or click · stays on this device</span>
        </FileDrop>
        {status && (
          <div>
            <ProgressBar value={null} />
            <p className="mt-1 text-[11px] text-neutral-400">{status}</p>
          </div>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </PanelSection>
      <PanelSection
        title="Sequence"
        right={
          <Button variant="ghost" size="xs" onClick={splitAtPlayhead} disabled={!project.clips.length} title="Split the clip under the playhead">
            <Scissors size={12} /> Split at playhead
          </Button>
        }
      >
        {project.clips.length === 0 ? (
          <EmptyState icon={<Film size={22} />} title="No clips yet" description="Import a recording to build your reel." />
        ) : (
          <ul className="space-y-1.5">
            {layouts.map((layout, i) => {
              const clip = layout.clip;
              const selected = selection?.kind === "clip" && selection.id === clip.id;
              return (
                <li
                  key={clip.id}
                  className={cx("rounded-lg border p-2", selected ? "border-brand-500/70 bg-brand-500/5" : "border-neutral-800 hover:border-neutral-700")}
                  onClick={() => {
                    select({ kind: "clip", id: clip.id });
                    seek(layout.start);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-neutral-800 text-[11px] text-neutral-300">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{clip.name}</p>
                      <p className="text-[11px] text-neutral-500">
                        {formatTime(layout.duration)} · {clip.width}×{clip.height}
                        {clip.speed !== 1 && ` · ${clip.speed}×`}
                        {!clip.hasAudio && " · no audio"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-0.5">
                    <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), move(clip.id, -1))} disabled={i === 0} title="Move up">
                      <ArrowUp size={13} />
                    </Button>
                    <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), move(clip.id, 1))} disabled={i === layouts.length - 1} title="Move down">
                      <ArrowDown size={13} />
                    </Button>
                    <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), duplicate(clip.id))} title="Duplicate">
                      <Copy size={13} />
                    </Button>
                    <Button variant="ghost" size="xs" className="ml-auto" onClick={(e) => (e.stopPropagation(), select({ kind: "clip", id: clip.id }), setTool("trim"))}>
                      Trim
                    </Button>
                    <Button variant="ghost" size="iconSm" className="text-red-300" onClick={(e) => (e.stopPropagation(), remove(clip.id))} title="Remove">
                      <Trash2 size={13} />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </PanelSection>
      <StockSection onImport={onFiles} disabled={!!status} />
      <PanelSection>
        <Button variant="outline" size="sm" className="w-full" onClick={cleanup} title="Delete imported files that no clip, sticker or music uses anymore">
          <Broom size={13} /> Clean up unused media
        </Button>
      </PanelSection>
    </>
  );
}
