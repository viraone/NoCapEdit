import { beforeEach, describe, expect, it } from "vitest";
import { createClip, createProject } from "@/lib/models/project";
import { useEditor } from "@/store/editorStore";
import { recapKey, useRecap } from "@/lib/recap/recapStore";
import { momentScopeOpen, pickActiveMoment } from "@/components/timeline/useActiveMoment";
import { deleteActiveMomentPiece, deleteTarget, splitActiveMoment } from "@/components/timeline/momentActions";
import type { MomentEdit } from "@/lib/recap/momentEdits";

const clip = createClip({ assetId: "a1", name: "Show", duration: 60, width: 1920, height: 1080, hasAudio: true });
const project = createProject({ name: "Show", clips: [clip] });
const laugh = { id: "l1", clipId: clip.id, start: 30, end: 32, score: 0.9 };
const key = recapKey(project.id, project.clips);

describe("active moment", () => {
  const scope = { tool: "recap", panelOpen: true, project, editingId: "l1", key, laughs: [laugh], edits: {} };

  it("returns the default edit when the moment has none", () => {
    const moment = pickActiveMoment(scope);
    expect(moment).not.toBeNull();
    expect(moment!.laugh.id).toBe("l1");
    expect(moment!.edit.pieces).toHaveLength(1);
    expect(moment!.edit.pieces[0].start).toBeCloseTo(26);
    expect(moment!.edited).toBe(false);
    expect(moment!.duration).toBeCloseTo(60);
  });

  it("returns the saved edit and says it is edited", () => {
    const edit: MomentEdit = { pieces: [{ start: 8, end: 9 }] };
    const moment = pickActiveMoment({ ...scope, edits: { l1: edit } });
    expect(moment!.edit).toBe(edit);
    expect(moment!.edited).toBe(true);
  });

  it("is null outside the Recap tool, with its panel closed, for another project's laughs, or for an unknown id", () => {
    expect(momentScopeOpen({ ...scope, tool: "clips" })).toBe(false);
    expect(momentScopeOpen({ ...scope, panelOpen: false })).toBe(false);
    expect(momentScopeOpen({ ...scope, editingId: null })).toBe(false);
    expect(momentScopeOpen({ ...scope, key: "other" })).toBe(false);
    expect(momentScopeOpen({ ...scope, laughs: null })).toBe(false);
    expect(momentScopeOpen({ ...scope, laughs: [{ ...laugh, id: "l2" }] })).toBe(false);
    expect(momentScopeOpen(scope)).toBe(true);
  });
});

describe("deleteTarget", () => {
  const edit: MomentEdit = {
    pieces: [
      { start: 0, end: 5 },
      { start: 10, end: 15 },
    ],
  };

  it("uses the selected piece", () => {
    expect(deleteTarget(edit, 1, 2)).toBe(1);
  });

  it("falls back to the piece under the playhead", () => {
    expect(deleteTarget(edit, null, 12)).toBe(1);
  });

  it("ignores a selection that no longer exists", () => {
    expect(deleteTarget(edit, 5, 2)).toBe(0);
  });

  it("returns -1 when the playhead is in a gap", () => {
    expect(deleteTarget(edit, null, 7)).toBe(-1);
  });
});

describe("recap store: moment editing", () => {
  beforeEach(() => {
    useRecap.setState({ edits: {}, editingId: null, selectedPiece: null, history: [] });
  });

  it("opens a moment with nothing selected and nothing to undo", () => {
    useRecap.setState({ selectedPiece: 2, history: [{ pieces: [{ start: 0, end: 1 }] }] });
    useRecap.getState().openMoment("m1");
    expect(useRecap.getState().editingId).toBe("m1");
    expect(useRecap.getState().selectedPiece).toBeNull();
    expect(useRecap.getState().history).toEqual([]);
  });

  it("closes a moment and clears everything it was using", () => {
    useRecap.getState().openMoment("m1");
    useRecap.getState().selectPiece(1);
    useRecap.getState().pushHistory({ pieces: [{ start: 0, end: 1 }] });
    useRecap.getState().closeMoment();
    expect(useRecap.getState().editingId).toBeNull();
    expect(useRecap.getState().selectedPiece).toBeNull();
    expect(useRecap.getState().history).toEqual([]);
  });

  it("records the state before each change, falling back to the default the caller passes", () => {
    const a: MomentEdit = { pieces: [{ start: 0, end: 5 }] };
    const b: MomentEdit = { pieces: [{ start: 1, end: 5 }] };
    const c: MomentEdit = { pieces: [{ start: 2, end: 5 }] };
    useRecap.getState().openMoment("m1");
    useRecap.getState().changeMoment(b, a);
    expect(useRecap.getState().edits.m1).toEqual(b);
    expect(useRecap.getState().history).toEqual([a]);
    useRecap.getState().changeMoment(c);
    expect(useRecap.getState().edits.m1).toEqual(c);
    expect(useRecap.getState().history).toEqual([a, b]);
  });

  it("walks back one change per undo, and stops at the oldest", () => {
    const a: MomentEdit = { pieces: [{ start: 0, end: 5 }] };
    const b: MomentEdit = { pieces: [{ start: 1, end: 5 }] };
    useRecap.getState().openMoment("m1");
    useRecap.getState().changeMoment(b, a);
    useRecap.getState().undoMoment();
    expect(useRecap.getState().edits.m1).toEqual(a);
    expect(useRecap.getState().history).toEqual([]);
    useRecap.getState().undoMoment();
    expect(useRecap.getState().edits.m1).toEqual(a);
  });

  it("treats a whole drag as one undo step", () => {
    const before: MomentEdit = { pieces: [{ start: 10, end: 20 }] };
    const mid: MomentEdit = { pieces: [{ start: 11, end: 20 }] };
    const after: MomentEdit = { pieces: [{ start: 12, end: 20 }] };
    useRecap.getState().openMoment("m1");
    useRecap.getState().pushHistory(before);
    useRecap.getState().setEdit("m1", mid);
    useRecap.getState().setEdit("m1", after);
    useRecap.getState().undoMoment();
    expect(useRecap.getState().edits.m1).toEqual(before);
    expect(useRecap.getState().history).toEqual([]);
  });
});

describe("moment buttons and keys (shared logic)", () => {
  beforeEach(() => {
    useEditor.setState({ project, tool: "recap", panelOpen: true, currentTime: 29, selection: null, past: [], future: [], notice: null });
    useRecap.setState({ key, laughs: [laugh], edits: {}, editingId: "l1", selectedPiece: null, history: [] });
  });

  it("splits the moment at the playhead, leaving the project alone", () => {
    expect(splitActiveMoment()).toBe(true);
    const edit = useRecap.getState().edits.l1;
    expect(edit.pieces).toEqual([
      { start: 26, end: 29 },
      { start: 29, end: 32.4 },
    ]);
    expect(useRecap.getState().history).toHaveLength(1);
    expect(useEditor.getState().project).toBe(project);
    expect(useEditor.getState().past).toHaveLength(0);
  });

  it("undoes a split in one step", () => {
    splitActiveMoment();
    useRecap.getState().undoMoment();
    expect(useRecap.getState().edits.l1.pieces).toHaveLength(1);
    expect(useRecap.getState().history).toHaveLength(0);
  });

  it("deletes the selected piece", () => {
    splitActiveMoment();
    useRecap.getState().selectPiece(0);
    expect(deleteActiveMomentPiece()).toBe(true);
    expect(useRecap.getState().edits.l1.pieces).toEqual([{ start: 29, end: 32.4 }]);
    expect(useRecap.getState().selectedPiece).toBeNull();
  });

  it("refuses to delete the only piece and says why", () => {
    expect(deleteActiveMomentPiece()).toBe(false);
    expect(useEditor.getState().notice).toBe("A moment needs at least one piece.");
  });

  it("refuses to split outside a piece and says why", () => {
    useEditor.setState({ currentTime: 0 });
    expect(splitActiveMoment()).toBe(false);
    expect(useEditor.getState().notice).toBe("Move the playhead inside the block to split it.");
  });

  it("does nothing when no moment is open", () => {
    useRecap.setState({ editingId: null });
    expect(splitActiveMoment()).toBe(false);
    expect(deleteActiveMomentPiece()).toBe(false);
    expect(useRecap.getState().edits).toEqual({});
  });
});
