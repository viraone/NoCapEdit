/**
 * The Auto-Reframe tool: runs the face tracker (autoReframe) over every video
 * clip in the project, one after another, so the user presses one button
 * instead of visiting each clip in Trim.
 */
import type { Clip, Keyframe } from "@/lib/models/project";
import type { Frame } from "@/lib/captions/renderer";
import { autoReframe } from "./autoReframe";

/** Clips the tool will track: videos (pictures have no face to follow), skipping ones already tracked unless `redo`. */
export function reframePlan(clips: Clip[], redo = false): Clip[] {
  return clips.filter((c) => !c.still && (redo || !c.reframe?.keyframes.length));
}

export interface ReframeProgress {
  clip: Clip;
  /** Position of this clip in the run, 0-based, and how many clips the run has. */
  index: number;
  count: number;
  message: string;
  progress: number | null;
}

export type ReframeResult = { keyframes: Keyframe[] } | { error: string };

export interface ReframeAllOptions {
  clips: Clip[];
  /** Object URLs by asset id (the editor's assetUrls). */
  urls: Record<string, string>;
  frame: Frame;
  signal?: AbortSignal;
  onProgress?: (p: ReframeProgress) => void;
  /** Called after each clip, so the picture starts following the face while later clips are still scanning. */
  onClipDone: (clip: Clip, result: ReframeResult) => void;
}

/**
 * Tracks the clips in order. A clip that fails (no face, file missing) is
 * reported and skipped; only a cancel stops the run, as an AbortError.
 */
export async function reframeAll(o: ReframeAllOptions): Promise<void> {
  for (let i = 0; i < o.clips.length; i++) {
    const clip = o.clips[i];
    if (o.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const url = o.urls[clip.assetId];
    if (!url) {
      o.onClipDone(clip, { error: "Source file is not loaded." });
      continue;
    }
    try {
      const keyframes = await autoReframe({
        videoUrl: url,
        clip,
        frame: o.frame,
        signal: o.signal,
        onProgress: (message, progress) => o.onProgress?.({ clip, index: i, count: o.clips.length, message, progress }),
      });
      o.onClipDone(clip, { keyframes });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      o.onClipDone(clip, { error: e instanceof Error ? e.message : String(e) });
    }
  }
}
