"use client";
import { useEffect, useState } from "react";
import { Play, Square } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { useRecap } from "@/lib/recap/recapStore";
import { defaultEdit, nudge, setCut, editPieces, type MomentEdit } from "@/lib/recap/momentEdits";
import { Button } from "@/components/ui/Button";

interface MomentEditorProps {
  laugh: { id: string; start: number; end: number };
  cues: { start: number; end: number; text: string }[];
  duration: number;
}

function formatClock(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const tenths = Math.floor((seconds - s) * 10);
  return `${m}:${sec.toString().padStart(2, "0")}.${tenths}`;
}

export function MomentEditor({ laugh, cues, duration }: MomentEditorProps) {
  const edits = useRecap((s) => s.edits);
  const setEdit = useRecap((s) => s.setEdit);
  const currentTime = useEditor((s) => s.currentTime);

  const current: MomentEdit = edits[laugh.id] ?? defaultEdit(laugh, cues, duration);
  const pieces = editPieces(current);
  const totalSeconds = pieces.reduce((sum, p) => sum + (p.end - p.start), 0);

  const [playing, setPlaying] = useState(false);
  const [cutFrom, setCutFrom] = useState<number | null>(null);

  // Playback subscription: pause at end, skip cut, stop when leaving range
  useEffect(() => {
    if (!playing) return;

    let done = false;
    const unsub = useEditor.subscribe(({ currentTime: ct, isPlaying: ip }) => {
      if (done) return;

      // Stop if isPlaying became false externally
      if (!ip) {
        done = true;
        setPlaying(false);
        return;
      }

      // Skip cut: if we're inside the cut range, seek past it
      if (current.cut && ct >= current.cut.start && ct < current.cut.end) {
        useEditor.getState().seek(current.cut.end);
        return;
      }

      // Pause at end
      if (ct >= current.end && ct <= current.end + 0.5) {
        done = true;
        engine.pause();
        setPlaying(false);
        return;
      }

      // Stop if playhead left the range
      if (ct < current.start - 0.5 || ct > current.end + 0.5) {
        done = true;
        engine.pause();
        setPlaying(false);
        return;
      }
    });

    return () => unsub();
  }, [playing, current.start, current.end, current.cut]);

  const handlePlay = () => {
    if (playing) {
      engine.pause();
      setPlaying(false);
      return;
    }
    useEditor.getState().seek(current.start);
    engine.play();
    setPlaying(true);
  };

  const handleNudgeStart = (delta: number) => {
    const updated = nudge(current, "start", delta, duration);
    setEdit(laugh.id, updated);
  };

  const handleNudgeEnd = (delta: number) => {
    const updated = nudge(current, "end", delta, duration);
    setEdit(laugh.id, updated);
  };

  const handleCutFrom = () => {
    setCutFrom(currentTime);
  };

  const handleCutTo = () => {
    if (cutFrom === null) return;
    const updated = setCut(current, cutFrom, currentTime);
    setEdit(laugh.id, updated);
    setCutFrom(null);
  };

  const handleUndoCut = () => {
    const updated: MomentEdit = { ...current, cut: null };
    setEdit(laugh.id, updated);
  };

  const handleReset = () => {
    setEdit(laugh.id, null);
  };

  const hasEdit = edits[laugh.id] !== undefined;
  const playheadInside = currentTime >= current.start && currentTime <= current.end;

  return (
    <div className="space-y-2.5 rounded-lg border border-sys-gray4 bg-sys-gray5/80 p-3" data-moment-editor>
      <p className="text-[15px] text-label-2">
        Plays {formatClock(current.start)} to {formatClock(current.end)} · {totalSeconds.toFixed(1)} s
      </p>

      <div className="flex items-center gap-2">
        <span className="w-[56px] shrink-0 text-[15px] font-semibold text-white">Starts</span>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="bar"
            className="w-full"
            onClick={() => handleNudgeStart(-1)}
            data-moment-start-earlier
          >
            1 s earlier
          </Button>
          <Button
            variant="outline"
            size="bar"
            className="w-full"
            onClick={() => handleNudgeStart(1)}
            data-moment-start-later
          >
            1 s later
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-[56px] shrink-0 text-[15px] font-semibold text-white">Ends</span>
        <div className="grid flex-1 grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="bar"
            className="w-full"
            onClick={() => handleNudgeEnd(-1)}
            data-moment-end-earlier
          >
            1 s earlier
          </Button>
          <Button
            variant="outline"
            size="bar"
            className="w-full"
            onClick={() => handleNudgeEnd(1)}
            data-moment-end-later
          >
            1 s later
          </Button>
        </div>
      </div>

      <Button
        variant="outline"
        size="bar"
        className="w-full"
        onClick={handlePlay}
        data-moment-play
      >
        {playing ? <Square size={14} /> : <Play size={14} />} {playing ? "Stop" : "Play this"}
      </Button>

      <div className="space-y-2">
        <p className="text-[17px] font-bold text-white">Cut out a middle part</p>
        <p className="text-[15px]">Press Play this. When the dull bit starts press Cut from here, and when it ends press Cut to here.</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="bar"
            className="w-full"
            onClick={handleCutFrom}
            disabled={!playheadInside}
            data-moment-cut-from
          >
            Cut from here
          </Button>
          <Button
            variant="outline"
            size="bar"
            className="w-full"
            onClick={handleCutTo}
            disabled={!playheadInside || cutFrom === null}
            data-moment-cut-to
          >
            Cut to here
          </Button>
        </div>
        {cutFrom !== null && (
          <p className="text-[14px] text-label-2">
            Cut starts at {formatClock(cutFrom)}. Now press Cut to here.
          </p>
        )}
        {current.cut && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-[14px] text-label-2">
              Leaves out {formatClock(current.cut.start)} to {formatClock(current.cut.end)}
            </p>
            <Button
              variant="ghost"
              size="bar"
              onClick={handleUndoCut}
            >
              Undo cut
            </Button>
          </div>
        )}
      </div>

      {hasEdit && (
        <Button
          variant="ghost"
          size="bar"
          onClick={handleReset}
        >
          Undo all changes
        </Button>
      )}
    </div>
  );
}
