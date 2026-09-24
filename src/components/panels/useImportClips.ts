"use client";
import { useState } from "react";
import { useEditor } from "@/store/editorStore";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";

/** Shared "add video files" flow used by the Clips panel and the top bar. */
export function useImportClips() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFiles = async (files: File[]) => {
    const state = useEditor.getState();
    const project = state.project;
    if (!project) return;
    setError(null);
    let added = 0;
    for (const [i, file] of files.entries()) {
      try {
        const { clip, assetId, blob } = await importVideo(file, project.id, (s) => setStatus(`${s} (${i + 1}/${files.length})`));
        state.registerAsset(assetId, blob);
        const isFirst = useEditor.getState().project?.clips.length === 0;
        state.update((p) => void p.clips.push(clip));
        if (isFirst) updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
        added++;
      } catch (e) {
        setError(`${file.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    setStatus(null);
    if (added) state.setNotice(`Added ${added} clip${added === 1 ? "" : "s"}.`);
  };

  return { onFiles, status, error, busy: !!status };
}
