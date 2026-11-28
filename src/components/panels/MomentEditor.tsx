"use client";
import { Check, Play, RotateCcw, Scissors, Square, Trash2, Undo2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { useRecap } from "@/lib/recap/recapStore";
import { defaultEdit, editLength } from "@/lib/recap/momentEdits";
import { formatTime } from "@/lib/utils/time";
import { deleteActiveMomentPiece, splitActiveMoment } from "@/components/timeline/momentActions";
import { Button } from "@/components/ui/Button";

interface MomentEditorProps {
  laugh: { id: string; start: number; end: number };
  cues: { start: number; end: number; text: string }[];
  duration: number;
}

/** Shown under the moment card while that moment is open on the timeline below. */
export function MomentEditor({ laugh, cues, duration }: MomentEditorProps) {
  const edit = useRecap((s) => s.edits[laugh.id]);
  const setEdit = useRecap((s) => s.setEdit);
  const undoMoment = useRecap((s) => s.undoMoment);
  const closeMoment = useRecap((s) => s.closeMoment);
  const canUndo = useRecap((s) => s.history.length > 0);
  const isPlaying = useEditor((s) => s.isPlaying);

  const current = edit ?? defaultEdit(laugh, cues, duration);
  const pieces = current.pieces;
  const first = pieces[0];
  const last = pieces[pieces.length - 1];

  const togglePlay = () => {
    if (isPlaying) {
      engine.pause();
      return;
    }
    if (!first) return;
    useEditor.getState().seek(Math.max(0, first.start));
    engine.play();
  };

  return (
    <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5/80 p-3" data-moment-editor>
      <p className="text-[15px] text-white">
        Edit on the timeline below: drag the orange edges. Split at the playhead, then delete the dull part.
      </p>
      <p className="text-[15px] text-label-2 tabular-nums" data-moment-summary>
        Plays {formatTime(first?.start ?? laugh.start)} to {formatTime(last?.end ?? laugh.end)} · {editLength(current).toFixed(1)} s
      </p>
      {pieces.length > 1 && (
        <p className="text-[14px] text-label-2" data-moment-pieces>
          {pieces.length} pieces
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" size="bar" className="w-full !px-1" onClick={togglePlay} data-moment-play>
          {isPlaying ? <Square size={14} /> : <Play size={14} />} {isPlaying ? "Stop" : "Play this"}
        </Button>
        <Button variant="secondary" size="bar" className="w-full !px-1" onClick={() => splitActiveMoment()} data-moment-split-panel>
          <Scissors size={14} /> Split at playhead
        </Button>
        <Button variant="secondary" size="bar" className="w-full !px-1" onClick={() => deleteActiveMomentPiece()} data-moment-delete-panel>
          <Trash2 size={14} /> Delete piece
        </Button>
        <Button variant="secondary" size="bar" className="w-full !px-1" onClick={undoMoment} disabled={!canUndo} data-moment-undo-panel>
          <Undo2 size={14} /> Undo
        </Button>
        {edit !== undefined && (
          <Button variant="outline" size="bar" className="w-full !px-1" onClick={() => setEdit(laugh.id, null)} data-moment-start-over>
            <RotateCcw size={14} /> Start over
          </Button>
        )}
        <Button variant="primary" size="bar" className="w-full !px-1" onClick={closeMoment} data-moment-done-panel>
          <Check size={14} /> Done
        </Button>
      </div>
    </div>
  );
}
