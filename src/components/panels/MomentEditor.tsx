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
    <div className="mt-1.5 space-y-1.5 rounded-md border border-sys-gray4 bg-sys-gray5/80 p-2" data-moment-editor>
      <p className="text-[11px] text-label-2">
        Plays {formatClock(current.start)} to {formatClock(current.end)} · {totalSeconds.toFixed(1)} s
      </p>

      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold text-white">Start</span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => handleNudgeStart(-1)}
          data-moment-start-earlier
        >
          − 1 s
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => handleNudgeStart(1)}
          data-moment-start-later
        >
          + 1 s
        </Button>
      </div>

      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[11px] font-semibold text-white">End</span>
        <Button
          variant="outline"
          size="xs"
          onClick={() => handleNudgeEnd(-1)}
          data-moment-end-earlier
        >
          − 1 s
        </Button>
        <Button
          variant="outline"
          size="xs"
          onClick={() => handleNudgeEnd(1)}
          data-moment-end-later
        >
          + 1 s
        </Button>
      </div>

      <Button
        variant="outline"
        size="xs"
        onClick={handlePlay}
        data-moment-play
      >
        {playing ? <Square size={11} /> : <Play size={11} />} {playing ? "Stop" : "Play this"}
      </Button>

      <div className="space-y-1">
        <p className="text-[11px] font-semibold text-white">Cut out a part</p>
        <p className="text-[10px] text-label-2">Press Play this, then mark where the dead part starts and ends.</p>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={handleCutFrom}
            disabled={!playheadInside}
            data-moment-cut-from
          >
            Cut from here
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={handleCutTo}
            disabled={!playheadInside || cutFrom === null}
            data-moment-cut-to
          >
            Cut to here
          </Button>
        </div>
        {current.cut && (
          <div className="flex items-center gap-1.5">
            <p className="text-[11px] text-label-2">
              Leaves out {formatClock(current.cut.start)} to {formatClock(current.cut.end)}
            </p>
            <Button
              variant="ghost"
              size="xs"
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
          size="xs"
          onClick={handleReset}
        >
          Reset
        </Button>
      )}
    </div>
  );
}
