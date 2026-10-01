"use client";
import { Play, Pause, SkipBack, ArrowRightToLine, ArrowLeftToLine, ArrowLeft, ArrowRight, Trash2, Film, Undo2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useTargetClip } from "@/components/panels/shared";
import { engine } from "@/lib/playback/engine";
import { projectDuration } from "@/lib/models/timeline";
import { captionsClearedNotice, cutAfter, cutBefore, moveClip, removeClip } from "@/lib/models/clipOps";
import { formatTime, formatTimecode } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";

/** Transport (centre) and clip actions (right), the top row of the timeline card. */
export function TransportBar() {
  const isPlaying = useEditor((s) => s.isPlaying);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project.clips) : 0));
  const clipCount = useEditor((s) => s.project?.clips.length ?? 0);
  const canUndo = useEditor((s) => s.past.length > 0);
  const { seek, update, select, setNotice, undo } = useEditor.getState();
  const clip = useTargetClip();
  const index = useEditor((s) => (clip ? s.project!.clips.findIndex((c) => c.id === clip.id) : -1));

  return (
    <div className="grid h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-3">
      <div />
      <div className="flex items-center gap-1.5">
        {/* Right by the timeline, so a click that cut the wrong spot is one click to take back. */}
        <Button variant="secondary" size="md" className="mr-1.5" onClick={undo} disabled={!canUndo} title="Undo the last edit (⌘Z)" data-transport-undo>
          <Undo2 size={15} /> Undo
        </Button>
        <Button variant="ghost" size="iconSm" onClick={() => seek(0)} title="Go to start (Home)">
          <SkipBack size={15} />
        </Button>
        <Button
          variant="ghost"
          size="iconSm"
          title="Cut before the playhead"
          disabled={!clip}
          onClick={() => {
            let ok = false;
            update((p) => void (ok = cutBefore(p, useEditor.getState().currentTime)), { ripple: true });
            setNotice(ok ? "Removed everything before the playhead." : "Nothing to cut before the playhead.");
          }}
        >
          <ArrowRightToLine size={15} />
        </Button>
        <button
          type="button"
          onClick={() => engine.toggle()}
          disabled={duration === 0}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-sys-blue text-white shadow-md shadow-sys-blue/30 transition-colors hover:bg-brand-400 disabled:opacity-40"
          title="Play / pause (Space)"
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
        </button>
        <Button
          variant="ghost"
          size="iconSm"
          title="Cut after the playhead"
          disabled={!clip}
          onClick={() => {
            let ok = false;
            update((p) => void (ok = cutAfter(p, useEditor.getState().currentTime)), { ripple: true });
            setNotice(ok ? "Removed everything after the playhead." : "Nothing to cut after the playhead.");
          }}
        >
          <ArrowLeftToLine size={15} />
        </Button>
        <span className="ml-2 font-mono text-[15px] tabular-nums">
          <span className="font-bold text-sys-blue">{formatTimecode(currentTime)}</span> <span className="text-label-3">/</span> <span className="text-label-2">{formatTime(duration)}</span>
        </span>
      </div>
      {/* The clip name gives way (ellipsis) before it ever runs into the time. */}
      <div className="flex min-w-0 items-center justify-end gap-1.5">
        {clip && (
          <>
            <span className="mr-1 flex min-w-0 items-center gap-1.5 text-[13px] text-white/75" title={clip.name}>
              <Film size={14} className="shrink-0" />
              <span className="truncate">{clip.name}</span>
            </span>
            <Button variant="secondary" size="md" className="shrink-0" disabled={index <= 0} onClick={() => update((p) => void moveClip(p, clip.id, -1), { ripple: true })} title="Move this clip earlier">
              <ArrowLeft size={15} /> Earlier
            </Button>
            <Button variant="secondary" size="md" className="shrink-0" disabled={index < 0 || index >= clipCount - 1} onClick={() => update((p) => void moveClip(p, clip.id, 1), { ripple: true })} title="Move this clip later">
              <ArrowRight size={15} /> Later
            </Button>
            <Button
              variant="danger"
              size="md"
              className="shrink-0"
              onClick={() => {
                let cleared = 0;
                update((p) => void (cleared = removeClip(p, clip.id).clearedCaptions), { ripple: true });
                select(null);
                setNotice(cleared ? captionsClearedNotice(cleared) : "Removed the clip.");
              }}
              title="Remove this clip"
            >
              <Trash2 size={15} /> Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
