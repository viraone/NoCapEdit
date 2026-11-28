import { pieceFor, type Cue, type Range } from "@/lib/recap/trailerRanges";

export interface MomentEdit {
  start: number;
  end: number;
  cut: Range | null;
}

export function defaultEdit(laugh: Range, cues: Cue[], duration: number): MomentEdit {
  const piece = pieceFor(laugh, cues, duration);
  return { start: piece.start, end: piece.end, cut: null };
}

export function nudge(
  edit: MomentEdit,
  side: "start" | "end",
  delta: number,
  duration: number,
): MomentEdit {
  const start =
    side === "start"
      ? Math.min(Math.max(edit.start + delta, 0), edit.end - 1)
      : edit.start;
  const end =
    side === "end"
      ? Math.min(Math.max(edit.end + delta, edit.start + 1), duration)
      : edit.end;

  let cut: Range | null = edit.cut;
  if (cut && !(cut.start >= start + 0.2 && cut.end <= end - 0.2)) {
    cut = null;
  }

  return { start, end, cut };
}

export function setCut(edit: MomentEdit, a: number, b: number): MomentEdit {
  const from = Math.max(Math.min(a, b), edit.start + 0.2);
  const to = Math.min(Math.max(a, b), edit.end - 0.2);
  const cut: Range | null = to - from >= 0.2 ? { start: from, end: to } : null;
  return { start: edit.start, end: edit.end, cut };
}

export function editPieces(edit: MomentEdit): Range[] {
  if (!edit.cut) {
    return [{ start: edit.start, end: edit.end }];
  }
  return [
    { start: edit.start, end: edit.cut.start },
    { start: edit.cut.end, end: edit.end },
  ];
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
