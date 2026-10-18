import type { Clip, MusicTrack } from "@/lib/models/project";
import { musicSpan } from "@/lib/models/musicTrim";
import { projectDuration } from "@/lib/models/timeline";

/** A song that outlasts the video by no more than this is close enough to leave alone. */
export const FIT_SLACK_SECONDS = 0.5;

export interface PictureFit {
  /** The last clip: the one to hold on screen longer. */
  clip: Clip;
  /** How long it should show, in timeline seconds, for the video to end with the song. */
  seconds: number;
  /** True when the clip is flagged as a picture; false when only its filmstrip can tell (a clip made before the flag existed). */
  known: boolean;
}

/**
 * How long the last clip should show for the whole song to play: set when the song outlasts the video
 * and that clip is, or may be, a picture (a flyer, a poster). Null when the song already fits, or the
 * last clip is a real recording.
 */
export function pictureFit(clips: Clip[], music: MusicTrack | null | undefined): PictureFit | null {
  const last = clips[clips.length - 1];
  if (!music || !last) return null;
  const span = musicSpan(music);
  const videoLen = projectDuration(clips);
  if (span <= videoLen + FIT_SLACK_SECONDS) return null;
  const known = last.still === true;
  if (!known && last.hasAudio) return null;
  return { clip: last, seconds: (last.outPoint - last.inPoint) / last.speed + (span - videoLen), known };
}
