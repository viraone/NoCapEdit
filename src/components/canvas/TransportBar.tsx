"use client";
import { Play, Pause, SkipBack, ArrowRightToLine, ArrowLeftToLine, ArrowLeft, ArrowRight, Trash2, Film } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useTargetClip } from "@/components/panels/shared";
import { engine } from "@/lib/playback/engine";
import { projectDuration } from "@/lib/models/timeline";
import { cutAfter, cutBefore, moveClip, removeClip } from "@/lib/models/clipOps";
import { formatTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";

function timecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** Transport (centre) and clip actions (right), the top row of the timeline card. */
export function TransportBar() {
  const isPlaying = useEditor((s) => s.isPlaying);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project.clips) : 0));
  const clipCount = useEditor((s) => s.project?.clips.length ?? 0);
  const { seek, update, select, setNotice } = useEditor.getState();
  const clip = useTargetClip();
  const index = useEditor((s) => (clip ? s.project!.clips.findIndex((c) => c.id === clip.id) : -1));

  return (
    <div className="grid h-11 grid-cols-[1fr_auto_1fr] items-center px-3">
      <div />
      <div className="flex items-center gap-1.5">
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
            update((p) => void (ok = cutBefore(p, useEditor.getState().currentTime)));
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
            update((p) => void (ok = cutAfter(p, useEditor.getState().currentTime)));
            setNotice(ok ? "Removed everything after the playhead." : "Nothing to cut after the playhead.");
          }}
        >
          <ArrowLeftToLine size={15} />
        </Button>
        <span className="ml-2 font-mono text-[13px] tabular-nums">
          <span className="font-bold text-sys-blue">{timecode(currentTime)}</span> <span className="text-label-3">/</span> <span className="text-label-2">{formatTime(duration)}</span>
        </span>
      </div>
      <div className="flex items-center justify-end gap-1.5">
        {clip && (
          <>
            <span className="mr-1 flex items-center gap-1.5 truncate text-[12px] text-label-2">
              <Film size={13} /> {clip.name}
            </span>
            <Button variant="secondary" size="sm" disabled={index <= 0} onClick={() => update((p) => void moveClip(p, clip.id, -1))} title="Move this clip earlier">
              <ArrowLeft size={13} /> Earlier
            </Button>
            <Button variant="secondary" size="sm" disabled={index < 0 || index >= clipCount - 1} onClick={() => update((p) => void moveClip(p, clip.id, 1))} title="Move this clip later">
              <ArrowRight size={13} /> Later
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() => {
                update((p) => removeClip(p, clip.id));
                select(null);
                setNotice("Removed the clip.");
              }}
              title="Remove this clip"
            >
              <Trash2 size={13} /> Remove
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
