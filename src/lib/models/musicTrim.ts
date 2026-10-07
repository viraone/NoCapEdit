/**
 * Trimming and cutting the music track.
 *
 * The song plays from project time 0. With no cuts it is one stretch of the file, `startOffset` to
 * `duration - endTrim`. A cut turns it into `pieces`: stretches of the file that play back to back,
 * so removing a piece closes the gap. Everything here works on that one list.
 */

/** The shortest piece of a song a trim or a cut may leave. */
export const MIN_MUSIC_SECONDS = 0.5;

/** A stretch of the music file, in file seconds. */
export interface MusicPiece {
  from: number;
  to: number;
}

interface TrimmedMusic {
  duration: number;
  startOffset: number;
  endTrim?: number;
  loop: boolean;
  pieces?: MusicPiece[];
}

type Cuttable = Pick<TrimmedMusic, "duration" | "startOffset" | "endTrim" | "pieces">;

const len = (p: MusicPiece) => p.to - p.from;

/** The pieces that play, in order. A song with no cuts is a single piece. */
export function musicPieces(m: Cuttable): MusicPiece[] {
  if (m.pieces?.length) return m.pieces;
  return [{ from: m.startOffset, to: m.duration - (m.endTrim ?? 0) }];
}

/** Whether the song has been cut into more than one piece. */
export function musicIsCut(m: Pick<TrimmedMusic, "pieces">): boolean {
  return (m.pieces?.length ?? 0) > 0;
}

/** Seconds of the song that play once: the sum of its pieces. */
export function musicSpan(m: Cuttable): number {
  return Math.max(0, musicPieces(m).reduce((sum, p) => sum + Math.max(0, len(p)), 0));
}

/** The longest the song could play: what plays now plus the file left after its last piece. */
export function musicMaxSpan(m: Cuttable): number {
  const ps = musicPieces(m);
  return musicSpan(m) + Math.max(0, m.duration - ps[ps.length - 1].to);
}

/** The place in the file where the song starts. */
export function musicStart(m: Cuttable): number {
  return musicPieces(m)[0].from;
}

/** A song that is cut or has a trimmed tail stops where it was cut, so Loop only applies to one that is whole. */
export function musicLoops(m: Pick<TrimmedMusic, "loop" | "endTrim" | "pieces">): boolean {
  return m.loop && !((m.endTrim ?? 0) > 0) && !musicIsCut(m);
}

/** Project time at which the fade-out ends: the video's end, or an earlier cut of the song. */
export function musicFadeEnd(m: TrimmedMusic, projectDuration: number): number {
  return (m.endTrim ?? 0) > 0 || musicIsCut(m) ? Math.min(projectDuration, musicSpan(m)) : projectDuration;
}

/** Where each piece sits on the timeline, in project seconds. */
export function musicLayout(m: Cuttable): { piece: MusicPiece; start: number; end: number }[] {
  let at = 0;
  return musicPieces(m).map((piece) => {
    const start = at;
    at += Math.max(0, len(piece));
    return { piece, start, end: at };
  });
}

/** Index of the piece playing at project time t (null once the song has ended). */
export function musicPieceAt(m: Cuttable, t: number): number | null {
  const layout = musicLayout(m);
  for (let i = 0; i < layout.length; i++) if (t < layout[i].end) return t >= 0 ? i : null;
  return null;
}

/**
 * Pieces covering project time [from, to): where in the file each part reads from and how long.
 * The export builds one input per slice.
 */
export function musicSlices(m: Cuttable, from: number, to: number): { source: number; length: number }[] {
  const out: { source: number; length: number }[] = [];
  for (const { piece, start, end } of musicLayout(m)) {
    const a = Math.max(from, start);
    const b = Math.min(to, end);
    if (b - a > 1e-3) out.push({ source: piece.from + (a - start), length: b - a });
  }
  return out;
}

/** Stores `pieces` on the song: one piece goes back to a plain start and end trim, which can loop. */
function commit(m: TrimmedMusic, pieces: MusicPiece[]): void {
  if (pieces.length === 1) {
    const [only] = pieces;
    m.startOffset = only.from;
    m.endTrim = m.duration - only.to < 0.05 ? 0 : m.duration - only.to;
    delete m.pieces;
    return;
  }
  m.pieces = pieces;
  m.startOffset = pieces[0].from;
  m.endTrim = 0;
}

const copy = (ps: MusicPiece[]) => ps.map((p) => ({ ...p }));

/** `pieces` with the head moved to file time `start`: only the first piece is shortened or lengthened. */
export function headTo(pieces: MusicPiece[], start: number): MusicPiece[] {
  const next = copy(pieces);
  next[0].from = Math.min(Math.max(0, start), next[0].to - MIN_MUSIC_SECONDS);
  return next;
}

/** `pieces` ending after `span` seconds of playing: later pieces are dropped, the last one shortened or stretched into the file. */
export function tailTo(pieces: MusicPiece[], fileDuration: number, span: number): MusicPiece[] {
  const total = pieces.reduce((sum, p) => sum + len(p), 0);
  const max = total + Math.max(0, fileDuration - pieces[pieces.length - 1].to);
  let left = Math.min(max, Math.max(Math.min(MIN_MUSIC_SECONDS, max), span));
  const next: MusicPiece[] = [];
  for (const p of pieces) {
    if (left <= 0.001) break;
    const take = Math.min(len(p), left);
    next.push({ from: p.from, to: p.from + take });
    left -= take;
  }
  // Longer than the pieces: the last one runs on into the file.
  if (left > 0.001) next[next.length - 1].to += left;
  next[next.length - 1].to = Math.min(next[next.length - 1].to, fileDuration);
  return next;
}

/** Writes a finished list of pieces to the song. */
export function applyMusicPieces(m: TrimmedMusic, pieces: MusicPiece[]): void {
  commit(m, pieces);
}

/** Moves the head of the song, keeping at least the minimum length. */
export function setMusicStart(m: TrimmedMusic, start: number): void {
  commit(m, headTo(musicPieces(m), start));
}

/** Sets the played length (clamped to what the file allows) by moving the tail. */
export function setMusicSpan(m: TrimmedMusic, span: number): void {
  commit(m, tailTo(musicPieces(m), m.duration, span));
}

/** Cuts the song in two at project time t. False when t is too close to an edge or a cut. */
export function splitMusicAt(m: TrimmedMusic, t: number): boolean {
  const layout = musicLayout(m);
  const hit = layout.find((l) => t > l.start && t < l.end);
  if (!hit || t - hit.start < MIN_MUSIC_SECONDS || hit.end - t < MIN_MUSIC_SECONDS) return false;
  const at = hit.piece.from + (t - hit.start);
  const next = layout.flatMap((l) => (l === hit ? [{ from: l.piece.from, to: at }, { from: at, to: l.piece.to }] : [{ ...l.piece }]));
  m.pieces = next;
  m.startOffset = next[0].from;
  m.endTrim = 0;
  return true;
}

/** Removes one piece and closes the gap. False when it is the only piece. */
export function removeMusicPiece(m: TrimmedMusic, index: number): boolean {
  const ps = musicPieces(m);
  if (ps.length < 2 || index < 0 || index >= ps.length) return false;
  commit(m, copy(ps).filter((_, i) => i !== index));
  return true;
}

/** Removes everything before project time t (the music then starts there). False when nothing would be left. */
export function cutMusicBefore(m: TrimmedMusic, t: number): boolean {
  if (t < 0.05 || musicSpan(m) - t < MIN_MUSIC_SECONDS) return false;
  const next: MusicPiece[] = [];
  for (const { piece, start, end } of musicLayout(m)) {
    if (end <= t) continue;
    next.push({ from: piece.from + Math.max(0, t - start), to: piece.to });
  }
  commit(m, next);
  return true;
}

/** Removes everything after project time t. False when nothing would be left. */
export function cutMusicAfter(m: TrimmedMusic, t: number): boolean {
  if (t < MIN_MUSIC_SECONDS || musicSpan(m) - t < 0.05) return false;
  commit(m, tailTo(musicPieces(m), m.duration, t));
  return true;
}
