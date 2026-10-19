/**
 * The weekly Instagram caption for the Rickshaw Read the Room Comedy Show.
 * Pure text in, text out: the handles and the date change each week, everything else is fixed.
 */

/** The six hashtags a caption picks five from. */
export const HASHTAG_POOL = ["#SeattleComedy", "#SeattleStandUp", "#SeattleComedyScene", "#SeattleLiveEvents", "#SeattleThingsToDo", "#PNWComedy"] as const;
const HASHTAGS_PER_POST = 5;

/** "danhurwitzcomedy", "@danhurwitzcomedy" or "instagram.com/danhurwitzcomedy/" all become "@danhurwitzcomedy". Empty when nothing usable is left. */
export function cleanHandle(raw: string): string {
  const fromUrl = raw.match(/instagram\.com\/([A-Za-z0-9._]+)/i)?.[1];
  const name = (fromUrl ?? raw).trim().replace(/^@+/, "").replace(/[^A-Za-z0-9._]/g, "");
  return name ? `@${name}` : "";
}

/** Handles typed as "@a @b", "a, b" or one per line, cleaned and de-duplicated (ignoring case). */
export function parseHandles(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of text.split(/[\s,;]+/)) {
    const h = cleanHandle(part);
    if (!h || seen.has(h.toLowerCase())) continue;
    seen.add(h.toLowerCase());
    out.push(h);
  }
  return out;
}

const ORDINAL = (n: number) => {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  return n + (teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th"));
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "October 2nd". */
export function formatShowDate(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${ORDINAL(d.getDate())}`;
}

/** Today when it is a Friday, otherwise the next Friday. Local time, midnight. */
export function nextFriday(from: Date = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7));
  return d;
}

/** A date input's "2026-10-23" as a local date (not UTC, which would slip a day back in the US). */
export function parseDateInput(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A date as the value of a date input. */
export function toDateInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Five of the six hashtags in a random order; a different one is left out each time you ask. `rng` is for tests. */
export function pickHashtags(rng: () => number = Math.random): string[] {
  const left = [...HASHTAG_POOL];
  left.splice(Math.floor(rng() * left.length), 1);
  for (let i = left.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [left[i], left[j]] = [left[j], left[i]];
  }
  return left.slice(0, HASHTAGS_PER_POST);
}

/** "A", "A and B", "A, B and C". */
const joinNames = (names: string[]) => (names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** The first line: who headlines and who features. */
export function lineupSentence(headliner: string, features: string[]): string {
  const head = headliner || "{HEADLINER}";
  if (!features.length) return `Rickshaw Read the Room Comedy Show is back. ${head} headlines.`;
  return `Rickshaw Read the Room Comedy Show is back. ${head} headlines, ${joinNames(features)} ${features.length === 1 ? "features" : "feature"}.`;
}

export interface RickshawPostInput {
  headliner: string;
  features: string[];
  /** "October 2nd". Shown as {DATE} while it is empty. */
  date: string;
  hashtags: string[];
}

export function buildRickshawPost({ headliner, features, date, hashtags }: RickshawPostInput): string {
  return [
    lineupSentence(headliner, features),
    `Friday, ${date.trim() || "{DATE}"}, 7-9 PM. Free show.`,
    "The Rickshaw, 322 N. 105th St, Seattle, WA 98133 (@rickshawseattle)",
    "Come through for good food, cold drinks, and funny people. Karaoke to follow. Support local comedy.",
    hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n");
}
