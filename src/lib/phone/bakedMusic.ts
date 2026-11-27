/**
 * Instagram can silence a well-known song that is part of an uploaded video (a Story posted silent this way).
 * These say when the Story window should warn about it.
 */
import type { VideoProject } from "@/lib/models/project";

/**
 * The name of the music track built into the video being posted, or null when there is none to worry about:
 * a picked file (not made from the open project), no project, no music track, or the track's volume is 0.
 */
export function bakedMusicName(project: Pick<VideoProject, "music"> | null | undefined, fromProject: boolean): string | null {
  if (!fromProject || !project?.music || project.music.volume <= 0) return null;
  return project.music.name.trim() || "your music track";
}

/**
 * Whether to warn: there is built-in music, no Instagram song is being added, and the video's sound is not muted
 * (muting means silence is what was asked for).
 */
export function shouldWarnBakedMusic(name: string | null, wantsSong: boolean, mute: boolean): name is string {
  return name !== null && !wantsSong && !mute;
}
