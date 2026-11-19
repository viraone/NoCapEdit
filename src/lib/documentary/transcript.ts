/** Timed captions and the plain-text / .srt forms the visitor copies or downloads. Pure, no I/O. */

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface Transcript {
  id: string;
  title: string;
  language: string;
  cues: TranscriptCue[];
}

/** "M:SS" under an hour, "H:MM:SS" from an hour. */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** The dialog as paragraphs: a new one after a 3 s pause, or at a sentence end once a paragraph passes 500 characters. */
export function cuesToText(cues: TranscriptCue[], opts: { timestamps?: boolean } = {}): string {
  const groups: TranscriptCue[][] = [];
  let current: TranscriptCue[] = [];
  let currentText = "";
  let prevEnd: number | null = null;
  for (const cue of cues) {
    const gap = prevEnd === null ? 0 : cue.start - prevEnd;
    if (current.length && (gap >= 3 || (currentText.length >= 500 && /[.?!]$/.test(currentText)))) {
      groups.push(current);
      current = [];
      currentText = "";
    }
    current.push(cue);
    currentText = currentText ? `${currentText} ${cue.text}` : cue.text;
    prevEnd = cue.end;
  }
  if (current.length) groups.push(current);
  return groups
    .map((g) => {
      const text = g.map((c) => c.text).join(" ");
      return opts.timestamps ? `[${formatClock(g[0].start)}] ${text}` : text;
    })
    .join("\n\n");
}

/** "HH:MM:SS,mmm". */
export function srtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00:00,000";
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const total = Math.floor(totalMs / 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(total / 3600))}:${p(Math.floor((total % 3600) / 60))}:${p(total % 60)},${p(ms, 3)}`;
}

/** A standard .srt file. */
export function cuesToSrt(cues: TranscriptCue[]): string {
  if (!cues.length) return "";
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}`).join("\n\n") + "\n";
}

/** A file name safe to save under, from the video's title. */
export function transcriptFileName(title: string, ext: "txt" | "srt" | "mp4"): string {
  const base = title.replace(/[^\p{L}\p{N} ._-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, 80).trim();
  return `${base || "transcript"}.${ext}`;
}

/** Keeps only well-formed cues from whatever the helper sent. */
export function normalizeCues(input: unknown): TranscriptCue[] {
  if (!Array.isArray(input)) return [];
  const out: TranscriptCue[] = [];
  for (const item of input) {
    if (typeof item !== "object" || item === null) continue;
    const { start, end, text } = item as { start?: unknown; end?: unknown; text?: unknown };
    if (typeof start !== "number" || !Number.isFinite(start)) continue;
    if (typeof end !== "number" || !Number.isFinite(end) || end < start) continue;
    if (typeof text !== "string" || !text.trim()) continue;
    out.push({ start, end, text: text.trim() });
  }
  return out;
}

/** Pasted text (a lesson, an article) as a transcript: one cue per paragraph, with made-up even times because there is no video. */
export function textToTranscript(title: string, text: string): Transcript {
  const cleaned = text.replace(/\r\n?/g, "\n").trim();
  const tidy = (s: string) => s.replace(/\s+/g, " ").trim();
  const paragraphs = cleaned.split(/\n\s*\n/).map(tidy).filter(Boolean);
  const pieces = paragraphs.length > 1 ? paragraphs : cleaned.split("\n").map(tidy).filter(Boolean);
  const cues: TranscriptCue[] = pieces.map((piece, i) => ({ start: i * 5, end: (i + 1) * 5, text: piece }));
  return { id: "pasted", title: title.trim() || "Pasted text", language: "en", cues };
}
