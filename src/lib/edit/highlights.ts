/**
 * On-device highlight finder: splits the transcript into sentences, scores
 * them with TF-IDF salience plus delivery cues (pace, questions, numbers,
 * direct address) and returns the best windows of a target length.
 */
import type { CaptionCue } from "@/lib/models/project";

export interface Sentence {
  text: string;
  start: number;
  end: number;
  words: number;
}

export interface Highlight {
  start: number;
  end: number;
  score: number;
  text: string;
  reasons: string[];
}

const STOP = new Set(
  "a an the and or but if so of to in on at for with from by as is are was were be been being it its this that these those i you he she we they me him her us them my your our their what which who whom when where why how not no yes do does did done have has had can could will would shall should may might must just very really also about into over than then there here up down out off again more most some such only own same too".split(" "),
);

const tokenize = (t: string) => t.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [];

export function sentencesFromCues(cues: CaptionCue[]): Sentence[] {
  const sorted = [...cues].sort((a, b) => a.start - b.start);
  const out: Sentence[] = [];
  let buf: CaptionCue[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.map((c) => c.text.trim()).join(" ");
    out.push({ text, start: buf[0].start, end: buf[buf.length - 1].end, words: tokenize(text).length });
    buf = [];
  };
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i];
    if (buf.length && c.start - buf[buf.length - 1].end > 1.2) flush();
    buf.push(c);
    const next = sorted[i + 1];
    if (/[.!?]["')\]]?$/.test(c.text.trim()) || !next) flush();
  }
  flush();
  return out;
}

export function scoreSentences(sentences: Sentence[]): number[] {
  const docs = sentences.map((s) => tokenize(s.text).filter((t) => !STOP.has(t) && t.length > 2));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const n = Math.max(1, docs.length);
  const paces = sentences.map((s) => s.words / Math.max(0.5, s.end - s.start));
  const meanPace = paces.reduce((a, b) => a + b, 0) / Math.max(1, paces.length);
  return sentences.map((s, i) => {
    const d = docs[i];
    if (!d.length) return 0;
    const tf = new Map<string, number>();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    const weights = [...tf.entries()].map(([t, c]) => c * Math.log(1 + n / (df.get(t) ?? 1)));
    const salience = weights.sort((a, b) => b - a).slice(0, 5).reduce((a, b) => a + b, 0) / Math.sqrt(d.length);
    let bonus = 0;
    // Intros and outros are rarely the highlight.
    if (/\b(welcome|channel|subscribe|thanks for watching|see you|like and|comment below)\b/i.test(s.text)) bonus -= 0.6;
    if (/\?/.test(s.text)) bonus += 0.15;
    if (/!/.test(s.text)) bonus += 0.1;
    if (/\d/.test(s.text)) bonus += 0.1;
    if (/\b(you|your)\b/i.test(s.text)) bonus += 0.1;
    if (/\b(secret|mistake|never|always|best|worst|why|how|truth|nobody|everyone)\b/i.test(s.text)) bonus += 0.15;
    const pace = meanPace > 0 ? Math.min(0.3, Math.max(-0.2, (paces[i] - meanPace) / meanPace) * 0.5) : 0;
    const length = s.words < 4 ? -0.2 : 0;
    return salience + bonus + pace + length;
  });
}

/** Best non-overlapping windows of about `targetSeconds` that start on a sentence boundary. */
export function findHighlights(cues: CaptionCue[], targetSeconds: number, count = 3): Highlight[] {
  const sentences = sentencesFromCues(cues);
  if (!sentences.length) return [];
  const scores = scoreSentences(sentences);
  const candidates: Highlight[] = [];
  for (let i = 0; i < sentences.length; i++) {
    let j = i;
    let total = 0;
    let weight = 0;
    const reasons = new Set<string>();
    while (j < sentences.length && sentences[j].end - sentences[i].start <= targetSeconds * 1.15) {
      const w = Math.max(0.5, sentences[j].end - sentences[j].start);
      total += scores[j] * w;
      weight += w;
      if (/\?/.test(sentences[j].text)) reasons.add("asks a question");
      if (/\d/.test(sentences[j].text)) reasons.add("has a concrete number");
      if (/\b(you|your)\b/i.test(sentences[j].text)) reasons.add("talks to the viewer");
      j++;
    }
    if (j === i) continue;
    const end = sentences[j - 1].end;
    const len = end - sentences[i].start;
    if (len < Math.min(targetSeconds * 0.4, 5)) continue;
    const fill = Math.min(1, len / targetSeconds);
    candidates.push({
      start: sentences[i].start,
      end,
      score: (total / Math.max(0.5, weight)) * (0.85 + 0.15 * fill),
      text: sentences.slice(i, j).map((s) => s.text).join(" "),
      reasons: [...reasons],
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const picked: Highlight[] = [];
  for (const c of candidates) {
    if (picked.some((p) => c.start < p.end && c.end > p.start)) continue;
    picked.push(c);
    if (picked.length >= count) break;
  }
  return picked;
}
