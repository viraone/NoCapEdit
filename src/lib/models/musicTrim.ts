/** The shortest piece of a song a trim may leave. */
export const MIN_MUSIC_SECONDS = 0.5;

interface TrimmedMusic {
  duration: number;
  startOffset: number;
  endTrim?: number;
  loop: boolean;
}

/** Seconds of the song that play once: the file minus the trimmed head and tail. */
export function musicSpan(m: Pick<TrimmedMusic, "duration" | "startOffset" | "endTrim">): number {
  return Math.max(0, m.duration - m.startOffset - (m.endTrim ?? 0));
}

/** A tail-trimmed song stops where it was cut, so Loop only applies to a song whose tail is intact. */
export function musicLoops(m: Pick<TrimmedMusic, "loop" | "endTrim">): boolean {
  return m.loop && !((m.endTrim ?? 0) > 0);
}

/** Project time at which the fade-out ends: the video's end, or an earlier cut of the song. */
export function musicFadeEnd(m: TrimmedMusic, projectDuration: number): number {
  return (m.endTrim ?? 0) > 0 ? Math.min(projectDuration, musicSpan(m)) : projectDuration;
}

/** Sets the played length (clamped to the file), expressed as a tail trim. */
export function setMusicSpan(m: TrimmedMusic, span: number): void {
  const room = Math.max(0, m.duration - m.startOffset);
  const next = Math.min(room, Math.max(Math.min(MIN_MUSIC_SECONDS, room), span));
  m.endTrim = room - next < 0.05 ? 0 : room - next;
}

/** Moves the head of the song, keeping at least the minimum length. */
export function setMusicStart(m: TrimmedMusic, start: number): void {
  const limit = Math.max(0, m.duration - (m.endTrim ?? 0) - MIN_MUSIC_SECONDS);
  m.startOffset = Math.min(limit, Math.max(0, start));
}
