"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editorStore";
import { useReelSlack } from "@/components/panels/shared";
import { applyReelReveal, applyReelStretch, reelMedia, reelSlack, stretchOf, stretchReel, type StretchStats } from "@/lib/edit/reelStretch";
import { uid } from "@/lib/utils/id";
import { formatTime } from "@/lib/utils/time";

export interface StretchJob {
  message: string;
  progress: number | null;
}

/** A clip's in and out points, media seconds; either may sit outside the media at the end of a drag. */
export interface InOut {
  inPoint: number;
  outPoint: number;
}

/** An edge drag on a clip block, from where it started to where it was released. */
export interface TrimDrag {
  clipId: string;
  from: InOut;
  to: InOut;
}

export function stretchNotice(s: StretchStats): string {
  const parts: string[] = [];
  if (s.before > 0.05) parts.push(`${formatTime(s.before)} before`);
  if (s.after > 0.05) parts.push(`${formatTime(s.after)} after`);
  const what = parts.length ? parts.join(" and ") : "the video";
  const cues = s.addedCues ? `, with ${s.addedCues} caption${s.addedCues === 1 ? "" : "s"} from the source` : "";
  const audio = s.droppedCleanAudio ? " The cleaned audio was reset; run Clean up audio again." : "";
  return `Brought back ${what} from the source video${cues}. Undo puts it back.${audio}`;
}

/**
 * Stretching a reel from the timeline: how far its clip may be dragged past
 * its media on each side, what to do when an edge drag ends, and the job that
 * cuts the wider range from the source video once an edge was released out
 * past the media.
 */
export function useReelStretch() {
  const slack = useReelSlack();
  const [job, setJob] = useState<StretchJob | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  /**
   * Ends an edge drag, inside the caller's undo transaction. On a reel the
   * clip snaps back to what its media holds, the captions follow the picture
   * and the source's captions fill any part revealed from the media's slack.
   * Returns the in/out points to cut from the source when the drag went past
   * the media, else null. Plain clips need nothing: their edges stop at the media.
   */
  const finishTrim = (drag: TrimDrag): InOut | null => {
    const state = useEditor.getState();
    const reel = state.project;
    const source = state.sourceProject;
    const clip = reel?.clips.find((c) => c.id === drag.clipId);
    if (!reel || !source || !clip || !reelSlack(reel, source)) return null;
    const media = reelMedia(reel)!;
    const held = { inPoint: Math.max(0, drag.to.inPoint), outPoint: Math.min(clip.duration, drag.to.outPoint) };
    const shown = { start: media.start + drag.from.inPoint, end: media.start + drag.from.outPoint };
    const range = { start: media.start + held.inPoint, end: media.start + held.outPoint };
    state.update(
      (p) => {
        const c = p.clips.find((c) => c.id === drag.clipId);
        if (!c) return;
        c.inPoint = held.inPoint;
        c.outPoint = held.outPoint;
        applyReelReveal(p, { shown, range, sourceCues: source.cues });
      },
      { history: false },
    );
    const past = stretchOf({ ...drag.to, duration: clip.duration });
    return past.before > 0 || past.after > 0 ? drag.to : null;
  };

  const start = async (req: InOut) => {
    const state = useEditor.getState();
    const reel = state.project;
    const source = state.sourceProject;
    if (abortRef.current || !reel || !source || !reelSlack(reel, source)) return;
    const media = reelMedia(reel)!;
    const range = { start: media.start + req.inPoint, end: media.start + req.outPoint };
    const controller = new AbortController();
    abortRef.current = controller;
    // Protected from "Clean up unused media" until the clip points at it.
    const assetId = uid("asset");
    state.markAssetPending(assetId);
    setJob({ message: "Starting", progress: null });
    try {
      const cut = await stretchReel({ source, reel, range, assetId, signal: controller.signal, onProgress: (message, progress) => setJob({ message, progress }) });
      // The user may have moved on to another project while ffmpeg ran.
      if (useEditor.getState().project?.id !== reel.id) return;
      state.registerAsset(assetId, cut.blob);
      let stats: StretchStats | null = null;
      state.update((p) => void (stats = applyReelStretch(p, { fresh: cut.clip, media: cut.media, range: cut.range, sourceCues: source.cues })));
      state.setNotice(stats ? stretchNotice(stats) : "Couldn't stretch this reel: it no longer has a single clip.");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) state.setNotice(`Couldn't bring back more of the video: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      state.unmarkAssetPending(assetId);
      abortRef.current = null;
      setJob(null);
    }
  };

  return { slack, job, finishTrim, start, cancel: () => abortRef.current?.abort() };
}
