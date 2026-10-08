/**
 * What we ask Chrome's built-in AI for a post, and how its answer is read back.
 * Pure text in, text out, so it works the same for any model and can be tested without one.
 */
import type { PostDraft } from "@/lib/models/project";

export type PostTone = "funny" | "friendly" | "professional" | "hype" | "chill";
export type PostLength = "short" | "medium" | "long";
export type PostPlatform = "instagram" | "tiktok" | "shorts" | "facebook";

export const TONES: { id: PostTone; label: string }[] = [
  { id: "funny", label: "Funny" },
  { id: "friendly", label: "Friendly" },
  { id: "professional", label: "Professional" },
  { id: "hype", label: "Hype" },
  { id: "chill", label: "Chill" },
];

export const LENGTHS: { id: PostLength; label: string; hint: string }[] = [
  { id: "short", label: "Short", hint: "one or two short sentences" },
  { id: "medium", label: "Medium", hint: "three or four sentences" },
  { id: "long", label: "Long", hint: "a short paragraph of five to seven sentences" },
];

export const PLATFORMS: { id: PostPlatform; label: string; hashtags: number }[] = [
  { id: "instagram", label: "Instagram", hashtags: 6 },
  { id: "tiktok", label: "TikTok", hashtags: 5 },
  { id: "shorts", label: "YouTube Shorts", hashtags: 4 },
  { id: "facebook", label: "Facebook", hashtags: 3 },
];

export interface PostRequest {
  /** What the video says (captions) or shows (text on the picture). */
  source: string;
  /** Anything the person wants mentioned: date, place, a link in bio. */
  notes: string;
  tone: PostTone;
  length: PostLength;
  platform: PostPlatform;
}

/** The most source text sent to the model; a small on-device model has a short memory. */
export const MAX_SOURCE_CHARS = 3500;

export const SYSTEM_PROMPT =
  "You write social media posts for short videos. Use only facts that appear in the material you are given; never invent dates, places, prices or names. Write in English. Do not use hashtags inside the caption.";

/** The JSON shape the Prompt API is told to answer in. */
export const POST_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    caption: { type: "string" },
    hashtags: { type: "array", items: { type: "string" } },
  },
  required: ["title", "caption", "hashtags"],
} as const;

export const hashtagCount = (platform: PostPlatform) => PLATFORMS.find((p) => p.id === platform)!.hashtags;

/** Trims the source to what fits, keeping the start and noting the cut. */
export function fitSource(text: string, max = MAX_SOURCE_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max).trimEnd()} …`;
}

export function buildUserPrompt(req: PostRequest): string {
  const platform = PLATFORMS.find((p) => p.id === req.platform)!;
  const length = LENGTHS.find((l) => l.id === req.length)!;
  const lines = [
    `Write a post for ${platform.label} about this video.`,
    `Tone: ${req.tone}.`,
    `Caption length: ${length.hint}.`,
    `Title: a short title of at most 8 words.`,
    `Hashtags: ${platform.hashtags} relevant hashtags, no spaces inside a hashtag.`,
    "",
    `What the video says or shows:`,
    fitSource(req.source) || "(nothing yet: use the notes below)",
  ];
  const notes = req.notes.trim();
  if (notes) lines.push("", `Also mention: ${notes}`);
  lines.push("", `Answer as JSON with the keys "title", "caption" and "hashtags" (a list of strings).`);
  return lines.join("\n");
}

/** One hashtag: leading #, letters and digits only. Empty when nothing usable is left. */
export function cleanHashtag(raw: string): string {
  const word = raw.replace(/^#+/, "").replace(/[^\p{L}\p{N}_]/gu, "");
  return word ? `#${word}` : "";
}

/** Tags cleaned, de-duplicated (ignoring case) and cut to `max`. */
export function cleanHashtags(list: string[], max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const tag = cleanHashtag(raw);
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

/** Hashtags pulled out of free text such as "#a #b, #c". */
export function hashtagsFromText(text: string): string[] {
  return cleanHashtags(text.match(/#[\p{L}\p{N}_]+/gu) ?? []);
}

/** "Title: x" / "**Caption:** y" lines, each running until the next label. */
function labelledFields(text: string): Partial<Record<"title" | "caption" | "hashtags", string>> {
  const out: Partial<Record<"title" | "caption" | "hashtags", string>> = {};
  let current: "title" | "caption" | "hashtags" | null = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^[\s*_#-]*(title|caption|hashtags)[\s*_]*:[\s*_]*(.*)$/i);
    if (m) {
      current = m[1].toLowerCase() as "title" | "caption" | "hashtags";
      out[current] = m[2];
    } else if (current) out[current] = `${out[current]}\n${line}`;
  }
  for (const k of Object.keys(out) as (keyof typeof out)[]) out[k] = out[k]!.trim();
  return out;
}

const unquote = (s: string) => s.trim().replace(/^["“'`]+|["”'`]+$/g, "").trim();

/**
 * Reads the model's answer. Normally it is the JSON we asked for; when it is not (the model rambled,
 * or wrapped it in a code fence), the labelled lines are used, and failing that the whole text is the caption.
 */
export function parsePostReply(raw: string, hashtagMax = 8): PostDraft {
  const text = raw.trim();
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const o = JSON.parse(json) as { title?: unknown; caption?: unknown; hashtags?: unknown };
      const tags = Array.isArray(o.hashtags) ? o.hashtags.filter((t): t is string => typeof t === "string") : typeof o.hashtags === "string" ? hashtagsFromText(o.hashtags) : [];
      const caption = typeof o.caption === "string" ? o.caption : "";
      if (caption || typeof o.title === "string") {
        return { title: typeof o.title === "string" ? unquote(o.title) : "", caption: caption.trim(), hashtags: cleanHashtags(tags, hashtagMax) };
      }
    } catch {
      /* not JSON after all: fall through to the labelled lines */
    }
  }
  const fields = labelledFields(text);
  const caption = fields.caption;
  const tags = hashtagsFromText(fields.hashtags ?? text);
  const body = caption ?? text.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
  return { title: unquote(fields.title ?? ""), caption: body, hashtags: tags.slice(0, hashtagMax) };
}

/** The post as one block of text, ready to paste: caption, a blank line, then the hashtags. */
export function postAsText(post: PostDraft): string {
  return [post.caption.trim(), post.hashtags.join(" ")].filter(Boolean).join("\n\n");
}
