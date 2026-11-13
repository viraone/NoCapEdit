"use client";
import { AlertTriangle, FolderOpen, Play, RefreshCw, Share2, Trash2 } from "lucide-react";
import { isEmptyReel } from "@/lib/edit/reelMaker";
import { projectDuration } from "@/lib/models/timeline";
import type { VideoProject } from "@/lib/models/project";
import { formatTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";

export interface ReelCardProps {
  reel: VideoProject;
  /** The project whose length and start to show: the live one while it is being edited. */
  shown: VideoProject;
  current: boolean;
  thumb?: string;
  isReel: boolean;
  busy: boolean;
  onOpen: () => void;
  onExport: () => void;
  onPreview: () => void;
  onRecut: (reel: VideoProject) => void;
  onDelete: () => Promise<void>;
}

/** The reel rows: thumbnail previews here, open in the editor, export, delete. In a reel, the one being edited is marked and a single click opens a sibling. */
export function ReelCard({ reel: r, shown, current, thumb, isReel, busy, onOpen, onExport, onPreview, onRecut, onDelete }: ReelCardProps) {
  const empty = isEmptyReel(r);
  return (
    <li
      data-reel={r.id}
      data-current={current || undefined}
      className={`flex items-center gap-2 rounded-lg border p-2 select-none ${current ? "border-sys-blue bg-sys-blue/10" : "cursor-pointer border-sys-gray4 bg-sys-gray5 hover:border-sys-gray3"}`}
      title={current ? "You're editing this reel" : isReel ? "Click to open this reel" : "Double-click to open this reel in the editor; press the thumbnail to preview it here"}
      onClick={isReel ? onOpen : undefined}
      onDoubleClick={onOpen}
    >
      <button type="button" className="group relative h-14 w-9 shrink-0 overflow-hidden rounded bg-sys-gray6" onClick={(e) => (e.stopPropagation(), !empty && onPreview())} aria-label={empty ? "This reel is empty" : "Play this reel"} disabled={empty}>
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : null}
        <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white opacity-80 group-hover:opacity-100">
          {empty ? <AlertTriangle size={14} className="text-sys-orange" /> : <Play size={14} fill="currentColor" />}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold">
          {/* The title gives way; the badge is never cut short. */}
          <span className="min-w-0 truncate">{r.reel?.title}</span>
          {current && <span className="shrink-0 rounded bg-sys-blue px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">Editing</span>}
        </p>
        {empty ? (
          <p className="text-[11px] text-sys-orange" data-reel-empty>
            Reel {r.reel?.index} · empty: the cut didn&apos;t finish
          </p>
        ) : (
          <p className="text-[11px] tabular-nums text-label-2">
            Reel {r.reel?.index} · {r.reel?.score}/10 · {formatTime(projectDuration(shown.clips))} · from {formatTime(shown.reel?.start ?? 0)}
          </p>
        )}
      </div>
      {!current && (
        <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), onOpen())} title="Open this reel">
          <FolderOpen size={13} />
        </Button>
      )}
      {empty ? (
        <Button variant="ghost" size="iconSm" className="text-sys-orange" onClick={(e) => (e.stopPropagation(), onRecut(r))} title="Cut this reel again from the source" disabled={busy} data-recut>
          <RefreshCw size={13} />
        </Button>
      ) : (
        <Button variant="ghost" size="iconSm" onClick={(e) => (e.stopPropagation(), onExport())} title="Export this reel">
          <Share2 size={13} />
        </Button>
      )}
      {!current && (
        <Button
          variant="ghost"
          size="iconSm"
          className="text-sys-red"
          title="Delete this reel"
          onClick={async (e) => {
            e.stopPropagation();
            await onDelete();
          }}
        >
          <Trash2 size={13} />
        </Button>
      )}
    </li>
  );
}
