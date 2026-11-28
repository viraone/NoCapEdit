import { pieceFor, type Cue, type Range } from "@/lib/recap/trailerRanges";

export interface MomentEdit {
  pieces: Range[];
}

export const MIN_PIECE = 0.2;

export function defaultEdit(laugh: Range, cues: Cue[], duration: number): MomentEdit {
  const piece = pieceFor(laugh, cues, duration);
  return { pieces: [{ start: piece.start, end: piece.end }] };
}

export function pieceAt(edit: MomentEdit, t: number): number {
  for (let i = 0; i < edit.pieces.length; i++) {
    const p = edit.pieces[i];
    if (p.start <= t && t < p.end) {
      return i;
    }
  }
  return -1;
}

export function splitPiece(edit: MomentEdit, t: number): MomentEdit | null {
  const index = pieceAt(edit, t);
  if (index === -1) return null;

  const piece = edit.pieces[index];
  const leftLen = t - piece.start;
  const rightLen = piece.end - t;

  if (leftLen < MIN_PIECE || rightLen < MIN_PIECE) {
    return null;
  }

  const newPieces = edit.pieces.slice();
  newPieces.splice(index, 1, { start: piece.start, end: t }, { start: t, end: piece.end });
  return { pieces: newPieces };
}

export function removePiece(edit: MomentEdit, index: number): MomentEdit | null {
  if (index < 0 || index >= edit.pieces.length) return null;
  if (edit.pieces.length === 1) return null;

  const newPieces = edit.pieces.slice();
  newPieces.splice(index, 1);
  return { pieces: newPieces };
}

export function resizePiece(
  edit: MomentEdit,
  index: number,
  side: "start" | "end",
  t: number,
  duration: number,
): MomentEdit {
  if (index < 0 || index >= edit.pieces.length) return edit;

  const newPieces = edit.pieces.map(p => ({ ...p }));
  const piece = newPieces[index];

  if (side === "start") {
    const prevEnd = index > 0 ? newPieces[index - 1].end : 0;
    const minStart = prevEnd;
    const maxStart = piece.end - MIN_PIECE;
    piece.start = Math.min(Math.max(t, minStart), maxStart);
  } else {
    const nextStart = index < newPieces.length - 1 ? newPieces[index + 1].start : duration;
    const minEnd = piece.start + MIN_PIECE;
    const maxEnd = nextStart;
    piece.end = Math.min(Math.max(t, minEnd), maxEnd);
  }

  return { pieces: newPieces };
}

export function editPieces(edit: MomentEdit): Range[] {
  if (edit.pieces.length === 0) return [];
  
  const sorted = edit.pieces.map(p => ({ ...p })).sort((a, b) => a.start - b.start);
  const joined: Range[] = [];
  
  for (const p of sorted) {
    if (joined.length === 0) {
      joined.push(p);
    } else {
      const last = joined[joined.length - 1];
      if (p.start - last.end <= 0.01) {
        last.end = Math.max(last.end, p.end);
      } else {
        joined.push(p);
      }
    }
  }
  
  return joined;
}

export function editLength(edit: MomentEdit): number {
  return edit.pieces.reduce((sum, p) => sum + (p.end - p.start), 0);
}

export function playStep(edit: MomentEdit, t: number): { seek: number } | "pause" | null {
  const pieces = edit.pieces;
  if (pieces.length === 0) return null;

  // Check if t is in a gap
  for (let i = 0; i < pieces.length - 1; i++) {
    const currentEnd = pieces[i].end;
    const nextStart = pieces[i + 1].start;
    if (t > currentEnd && t < nextStart) {
      if (nextStart - currentEnd > 0.01) {
        return { seek: nextStart };
      }
    }
  }

  // Check if t is at the end
  const lastEnd = pieces[pieces.length - 1].end;
  if (t >= lastEnd && t <= lastEnd + 0.5) {
    return "pause";
  }

  return null;
}

export function keptRanges(
  laughs: { id: string; start: number; end: number }[],
  edits: Record<string, MomentEdit>,
  cues: Cue[],
  duration: number,
): Range[] {
  const pieces: Range[] = [];
  for (const laugh of laughs) {
    const edit = edits[laugh.id] ?? defaultEdit(laugh, cues, duration);
    pieces.push(...editPieces(edit));
  }

  pieces.sort((a, b) => a.start - b.start);

  const merged: Range[] = [];
  for (const p of pieces) {
    if (merged.length === 0) {
      merged.push({ ...p });
    } else {
      const last = merged[merged.length - 1];
      if (p.start <= last.end) {
        last.end = Math.max(last.end, p.end);
      } else {
        merged.push({ ...p });
      }
    }
  }
  return merged;
}
