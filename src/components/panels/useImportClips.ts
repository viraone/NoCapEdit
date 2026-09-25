"use client";
import { useEditor } from "@/store/editorStore";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { uid } from "@/lib/utils/id";
import { importErrorText } from "@/lib/media/importFeedback";

/**
 * Shared "add video files" flow used by the Clips panel and the top bar. The
 * busy/progress state lives in the store, so every entry point sees an import
 * started from any other one.
 */
export function useImportClips() {
  const status = useEditor((s) => s.importStatus);
  // In the store, so a failure from the top bar shows in the Clips panel too.
  const error = useEditor((s) => s.importError);

  const onFiles = async (files: File[]) => {
    const state = useEditor.getState();
    const project = state.project;
    if (!project || state.importStatus) return;
    // Writes stop once the user has moved on to another project.
    const current = () => useEditor.getState().project?.id === project.id;
    state.setImportError(null);
    const failures: { name: string; reason: string }[] = [];
    let added = 0;
    state.setImportStatus(`Reading ${files[0]?.name ?? ""} (1/${files.length})`);
    try {
      for (const [i, file] of files.entries()) {
        // Protect the asset from "Clean up unused media" from the moment it is
        // written until its clip is in the project.
        const assetId = uid("asset");
        state.markAssetPending(assetId);
        try {
          const { clip, blob } = await importVideo(file, project.id, (s) => current() && state.setImportStatus(`${s} (${i + 1}/${files.length})`), assetId);
          if (!current()) continue;
          state.registerAsset(assetId, blob);
          const isFirst = useEditor.getState().project?.clips.length === 0;
          state.update((p) => void p.clips.push(clip));
          if (isFirst) updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
          added++;
        } catch (e) {
          failures.push({ name: file.name, reason: e instanceof Error ? e.message : String(e) });
        } finally {
          state.unmarkAssetPending(assetId);
        }
      }
    } finally {
      if (current()) state.setImportStatus(null);
    }
    if (!current()) return;
    state.setImportError(importErrorText(failures));
    if (added) state.setNotice(`Added ${added} clip${added === 1 ? "" : "s"}.`);
  };

  return { onFiles, status, error, busy: !!status };
}
