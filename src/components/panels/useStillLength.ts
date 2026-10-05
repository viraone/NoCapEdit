"use client";
import { useEffect, useState } from "react";
import { useEditor } from "@/store/editorStore";
import type { Clip } from "@/lib/models/project";
import { getAsset } from "@/lib/storage/db";
import { importVideo } from "@/lib/media/import";
import { looksLikeStill, renderStillLength, MAX_STILL_SECONDS } from "@/lib/media/stillLength";
import { uid } from "@/lib/utils/id";

/** Whether a clip is a picture held still: flagged when it was made from an image, else judged from its filmstrip. */
export function useIsStill(clip: Clip | undefined): boolean {
  const [judged, setJudged] = useState<{ assetId: string; still: boolean } | null>(null);
  const assetId = clip?.assetId;
  const flagged = clip?.still === true;
  const silent = clip ? !clip.hasAudio : false;
  useEffect(() => {
    if (!assetId || flagged || !silent) return;
    let alive = true;
    looksLikeStill(assetId)
      .then((still) => alive && setJudged({ assetId, still }))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [assetId, flagged, silent]);
  return flagged || (silent && !!judged && judged.assetId === assetId && judged.still);
}

/** Shows a picture clip for a different length: renders it again at that length and swaps the clip's media. */
export function useStillLength() {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (clipId: string, seconds: number) => {
    const state = useEditor.getState();
    const project = state.project;
    const clip = project?.clips.find((c) => c.id === clipId);
    if (!project || !clip || status) return;
    const target = Math.min(MAX_STILL_SECONDS, Math.max(1, seconds));
    setError(null);
    setStatus("Preparing the picture");
    const assetId = uid("asset");
    state.markAssetPending(assetId);
    try {
      const asset = await getAsset(clip.assetId);
      if (!asset) throw new Error("The picture's file is missing.");
      // The clip's speed stretches media time, so the media is rendered that much longer or shorter.
      const file = await renderStillLength(asset.blob, clip.name, target * clip.speed, (m) => setStatus(m));
      const { clip: made, blob } = await importVideo(file, project.id, (m) => setStatus(m), assetId);
      if (useEditor.getState().project?.id !== project.id) return;
      state.registerAsset(assetId, blob);
      state.update(
        (p) => {
          const c = p.clips.find((c) => c.id === clipId);
          if (!c) return;
          c.assetId = assetId;
          c.duration = made.duration;
          c.inPoint = 0;
          c.outPoint = made.duration;
          c.still = true;
        },
        // Captions, text and the clips after this one move with the new length.
        { ripple: true },
      );
      state.setNotice(`The picture now shows for ${Math.round(target)} s.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      state.unmarkAssetPending(assetId);
      setStatus(null);
    }
  };

  return { run, status, error, busy: status !== null };
}
