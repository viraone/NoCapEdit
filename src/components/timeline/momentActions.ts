import { useEditor } from "@/store/editorStore";
import { useRecap } from "@/lib/recap/recapStore";
import { pieceAt, removePiece, splitPiece, type MomentEdit } from "@/lib/recap/momentEdits";
import { activeMoment } from "./useActiveMoment";

/** Which piece Delete removes: the selected one, or the one under the playhead. -1 when there is none. */
export function deleteTarget(edit: MomentEdit, selected: number | null, t: number): number {
  if (selected !== null && selected >= 0 && selected < edit.pieces.length) return selected;
  return pieceAt(edit, t);
}

/** Splits the open moment at the playhead. The project itself is never touched. */
export function splitActiveMoment(): boolean {
  const moment = activeMoment();
  if (!moment) return false;
  const next = splitPiece(moment.edit, useEditor.getState().currentTime);
  if (!next) {
    useEditor.getState().setNotice("Move the playhead inside the block to split it.");
    return false;
  }
  useRecap.getState().changeMoment(next, moment.edit);
  return true;
}

/** Deletes the selected piece of the open moment, or the piece under the playhead. The project itself is never touched. */
export function deleteActiveMomentPiece(): boolean {
  const moment = activeMoment();
  if (!moment) return false;
  const recap = useRecap.getState();
  const index = deleteTarget(moment.edit, recap.selectedPiece, useEditor.getState().currentTime);
  const next = removePiece(moment.edit, index);
  if (!next) {
    useEditor.getState().setNotice(index === -1 ? "Move the playhead inside a block to delete it." : "A moment needs at least one piece.");
    return false;
  }
  recap.changeMoment(next, moment.edit);
  recap.selectPiece(null);
  return true;
}
