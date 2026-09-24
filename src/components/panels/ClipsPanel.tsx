"use client";
import { useState } from "react";
import { Upload, ArrowUp, ArrowDown, Scissors, Copy, Trash2, Film, Broom, Video } from "lucide-react";
import { Recorder, useRecordingSupported } from "@/components/record/Recorder";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { useImportClips } from "./useImportClips";
import { layoutClips } from "@/lib/models/timeline";
import { duplicateClip, moveClip, removeClip, splitClipAt } from "@/lib/models/clipOps";
import { deleteAsset, listProjectAssets } from "@/lib/storage/db";
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
  const { update, select, seek, setTool, setNotice } = useEditor.getState();
  const { onFiles, status, error } = useImportClips();
  const [cleanupNote, setCleanupNote] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const canRecord = useRecordingSupported();

  const move = (id: string, dir: -1 | 1) => update((p) => void moveClip(p, id, dir));
  const splitAtPlayhead = () => {
    let ok = false;
    update((p) => void (ok = splitClipAt(p, useEditor.getState().currentTime) !== null));
    setNotice(ok ? "Split the clip at the playhead." : "Move the playhead inside a clip to split it.");
  };
  const duplicate = (id: string) => update((p) => void duplicateClip(p, id));
  const remove = (id: string) => {
    update((p) => removeClip(p, id));
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
    setCleanupNote(n ? `Removed ${n} unused file${n === 1 ? "" : "s"}` : "Nothing to clean up");
    setTimeout(() => setCleanupNote(null), 2500);
  };

  const layouts = layoutClips(project.clips);

  return (
    <>
      <PanelHeader title="Clips" description="Import recordings, order them and split at the playhead." />
      <PanelSection>
        <FileDrop accept="video/*" multiple onFiles={onFiles} disabled={!!status} className="flex flex-col items-center gap-1.5">
          <Upload size={18} className="text-label-2" />
          <span className="text-[13px] font-semibold">Add video files</span>
          <span className="text-[11px] text-label-3">Drag & drop or click · stays on this device</span>
        </FileDrop>
        {status && (
          <div>
            <ProgressBar value={null} />
            <p className="mt-1 text-[11px] text-label-2">{status}</p>
          </div>
        )}
        {error && <p className="text-[11px] text-sys-red">{error}</p>}
        {canRecord && (
          <Button variant="secondary" size="sm" className="w-full" onClick={() => setRecording(true)} disabled={!!status}>
            <Video size={13} /> Record screen or camera
          </Button>
        )}
        <Recorder open={recording} onClose={() => setRecording(false)} onRecorded={(file) => {
          setRecording(false);
          onFiles([file]);
        }} />
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
                  className={cx("rounded-xl border p-2", selected ? "border-sys-blue bg-sys-blue/10" : "border-sys-gray4 bg-sys-gray5 hover:border-sys-gray3")}
                  onClick={() => {
                    select({ kind: "clip", id: clip.id });
                    seek(layout.start);
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sys-gray4 text-[11px] text-white">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold">{clip.name}</p>
                      <p className="text-[11px] text-label-2">
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
                    <Button variant="ghost" size="iconSm" className="text-sys-red" onClick={(e) => (e.stopPropagation(), remove(clip.id))} title="Remove">
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
        {cleanupNote && <p className="text-[11px] text-label-2">{cleanupNote}</p>}
      </PanelSection>
    </>
  );
}
