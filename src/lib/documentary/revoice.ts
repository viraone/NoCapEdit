/** Re-making a saved documentary film with another narrator voice. Pure, no DOM. */
import type { Clip, ProjectDocumentary, VideoProject } from "@/lib/models/project";
import type { FilmHeight } from "./film";
import type { FilmTimeline } from "./timeline";

/** How the saved film was pictured. Projects saved before this was recorded are read from their script. */
export function filmStyle(doc: ProjectDocumentary): "documentary" | "animation" {
  if (doc.style) return doc.style;
  return doc.script.scenes.some((scene) => scene.visual !== undefined) ? "animation" : "documentary";
}

/** The re-render never goes above 1080p, and films smaller than that stay at 720p. */
export function filmHeightFor(clipHeight: number): FilmHeight {
  return clipHeight >= 1080 ? 1080 : 720;
}

/**
 * Swaps a project's film clip for the re-rendered one and updates what the editor's chat
 * knows about it. Mutates the draft handed in by the editor store's update(), so the whole
 * swap is one undo step. The old film asset is left in storage for that undo.
 */
export function applyRevoice(
  p: VideoProject,
  next: { clip: Clip; timeline: FilmTimeline; voice: string; style: "documentary" | "animation" },
): void {
  if (!p.documentary) return;
  const oldAssetId = p.documentary.assetId;
  const old = p.clips.find((clip) => clip.assetId === oldAssetId);

  if (!old) {
    p.clips.unshift(next.clip);
  } else {
    const replacement: Clip = { ...next.clip, background: old.background, look: old.look ?? null };
    const clips: Clip[] = [];
    let placed = false;
    for (const clip of p.clips) {
      if (clip.assetId !== oldAssetId) clips.push(clip);
      else if (!placed) {
        clips.push(replacement);
        placed = true;
      }
    }
    p.clips = clips;
  }

  p.documentary = {
    ...p.documentary,
    assetId: next.clip.assetId,
    timeline: next.timeline,
    voice: next.voice,
    style: next.style,
  };
}
