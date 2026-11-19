/** Glue between the editor and the documentary chat: which second of the film is under the editor's playhead. Pure, no I/O. */
import type { Clip, ProjectDocumentary } from "@/lib/models/project";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";

/**
 * The film's own time (seconds) under the editor's playhead at project time `t`. Trimming, splitting or
 * speeding up the film's clip moves the editor's clock away from the film's; this brings it back.
 * 0 when there are no clips, or when the clip under the playhead is not the film.
 */
export function filmTimeAt(doc: ProjectDocumentary, clips: Clip[], t: number): number {
  const at = Math.max(0, t);
  const frame = locateFrame(layoutClips(clips), at);
  if (!frame || frame.primary.clip.assetId !== doc.assetId) return 0;
  return Math.min(doc.timeline.total, Math.max(0, toSourceTime(frame.primary, at)));
}
