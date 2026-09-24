import type { CaptionCue } from "@/lib/models/project";
import { uid } from "@/lib/utils/id";
import { formatSrtTime, parseSrtTime } from "@/lib/utils/time";

export function toSrt(cues: CaptionCue[], useTranslated = false): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  return sorted
    .map((c, i) => {
      const text = (useTranslated && c.translatedText?.trim() ? c.translatedText : c.text).trim();
      return `${i + 1}\n${formatSrtTime(c.start)} --> ${formatSrtTime(c.end)}\n${text}\n`;
    })
    .join("\n");
}

/** Plain transcript: one paragraph per pause longer than a second. */
export function toTranscript(cues: CaptionCue[], useTranslated = false): string {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const paragraphs: string[] = [];
  let current: string[] = [];
  let lastEnd = -Infinity;
  for (const c of sorted) {
    const text = (useTranslated && c.translatedText?.trim() ? c.translatedText : c.text).trim();
    if (!text) continue;
    if (current.length && c.start - lastEnd > 1) {
      paragraphs.push(current.join(" "));
      current = [];
    }
    current.push(text);
    lastEnd = c.end;
  }
  if (current.length) paragraphs.push(current.join(" "));
  return paragraphs.join("\n\n") + "\n";
}

export function parseSrt(text: string): CaptionCue[] {
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  const cues: CaptionCue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((l) => l.trim().length);
    if (lines.length < 2) continue;
    const timeLineIdx = lines.findIndex((l) => l.includes("-->"));
    if (timeLineIdx < 0) continue;
    const [a, b] = lines[timeLineIdx].split("-->");
    const start = parseSrtTime(a);
    const end = parseSrtTime((b ?? "").trim().split(/\s+/)[0] ?? "");
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = lines
      .slice(timeLineIdx + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .trim();
    if (!body) continue;
    cues.push({ id: uid("cue"), start, end, text: body, anchor: null });
  }
  return cues;
}
