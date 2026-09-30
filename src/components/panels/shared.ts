import { useMemo } from "react";
import { useEditor } from "@/store/editorStore";
import { layoutClips } from "@/lib/models/timeline";
import { reelSlack, type Slack } from "@/lib/edit/reelStretch";
import type { Clip, VideoProject } from "@/lib/models/project";

export function useProject(): VideoProject {
  return useEditor((s) => s.project!);
}

/** For a one-clip reel whose source is still here: seconds of the source video outside its media on each side, else null. */
export function useReelSlack(): Slack | null {
  const project = useEditor((s) => s.project);
  const source = useEditor((s) => s.sourceProject);
  return useMemo(() => (project ? reelSlack(project, source) : null), [project, source]);
}

/** The selected clip, or the clip under the playhead when nothing is selected. */
export function useTargetClip(): Clip | null {
  return useEditor((s) => {
    const p = s.project;
    if (!p) return null;
    if (s.selection?.kind === "clip") {
      const c = p.clips.find((c) => c.id === s.selection!.id);
      if (c) return c;
    }
    const layouts = layoutClips(p.clips);
    let found: Clip | null = null;
    for (const l of layouts) if (s.currentTime >= l.start) found = l.clip;
    return found ?? p.clips[0] ?? null;
  });
}

/** Handlers that turn a slider drag into a single undo step. */
export function useSliderTx() {
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const endTransaction = useEditor((s) => s.endTransaction);
  return { onDragStart: beginTransaction, onDragEnd: endTransaction };
}
