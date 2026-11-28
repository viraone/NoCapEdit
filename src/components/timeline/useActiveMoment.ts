"use client";
import { useMemo } from "react";
import { useEditor } from "@/store/editorStore";
import { useRecap, recapKey } from "@/lib/recap/recapStore";
import { defaultEdit, type MomentEdit } from "@/lib/recap/momentEdits";
import { layoutClips } from "@/lib/models/timeline";
import type { Clip } from "@/lib/models/project";
import type { Laugh } from "@/lib/recap/findLaughs";
import type { Cue } from "@/lib/recap/trailerRanges";

export interface ActiveMoment {
  laugh: Laugh;
  /** The pieces as they stand now: the saved edit, or the default for this laugh. */
  edit: MomentEdit;
  /** Whether the user has changed this moment (Start over appears only then). */
  edited: boolean;
  cues: Cue[];
  duration: number;
}

/** Everything the check below reads; the stores and the pure tests fill it the same way. */
interface MomentScope {
  tool: string;
  panelOpen: boolean;
  project: { id: string; clips: Clip[]; cues?: Cue[] } | null;
  editingId: string | null;
  key: string;
  laughs: Laugh[] | null;
}

/** Whether a moment is open on the timeline right now (the Recap panel, for this project's laughs). */
export function momentScopeOpen(scope: MomentScope): boolean {
  const { tool, panelOpen, project, editingId, key, laughs } = scope;
  if (tool !== "recap" || !panelOpen || !editingId || !project || !laughs) return false;
  if (key !== recapKey(project.id, project.clips)) return false;
  return laughs.some((l) => l.id === editingId);
}

/** The moment being edited on the timeline, or null when none is open. */
export function pickActiveMoment(scope: MomentScope & { edits: Record<string, MomentEdit> }): ActiveMoment | null {
  if (!momentScopeOpen(scope) || !scope.editingId) return null;
  const laugh = scope.laughs!.find((l) => l.id === scope.editingId);
  if (!laugh || !scope.project) return null;
  const cues = scope.project.cues ?? [];
  const duration = layoutClips(scope.project.clips).reduce((max, l) => Math.max(max, l.end), 0);
  const stored = scope.edits[scope.editingId];
  return {
    laugh,
    edit: stored ?? defaultEdit(laugh, cues, duration),
    edited: stored !== undefined,
    cues,
    duration,
  };
}

/** The moment being edited, read outside render (event handlers, store listeners). */
export function activeMoment(): ActiveMoment | null {
  const editor = useEditor.getState();
  const recap = useRecap.getState();
  return pickActiveMoment({
    tool: editor.tool,
    panelOpen: editor.panelOpen,
    project: editor.project,
    editingId: recap.editingId,
    key: recap.key,
    laughs: recap.laughs,
    edits: recap.edits,
  });
}

/** Re-renders while the open moment (or its pieces) change. */
export function useActiveMoment(): ActiveMoment | null {
  const tool = useEditor((s) => s.tool);
  const panelOpen = useEditor((s) => s.panelOpen);
  const project = useEditor((s) => s.project);
  const editingId = useRecap((s) => s.editingId);
  const key = useRecap((s) => s.key);
  const laughs = useRecap((s) => s.laughs);
  const edits = useRecap((s) => s.edits);
  return useMemo(
    () => pickActiveMoment({ tool, panelOpen, project, editingId, key, laughs, edits }),
    [tool, panelOpen, project, editingId, key, laughs, edits],
  );
}

/** Whether a moment is open, without re-rendering for every piece drag (the whole timeline uses this). */
export function useMomentActive(): boolean {
  const tool = useEditor((s) => s.tool);
  const panelOpen = useEditor((s) => s.panelOpen);
  const project = useEditor((s) => s.project);
  const editingId = useRecap((s) => s.editingId);
  const key = useRecap((s) => s.key);
  const laughs = useRecap((s) => s.laughs);
  return useMemo(
    () => momentScopeOpen({ tool, panelOpen, project, editingId, key, laughs }),
    [tool, panelOpen, project, editingId, key, laughs],
  );
}
