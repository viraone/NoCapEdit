/** The script for the "animation" film style: the documentary script plus a picture for every scene. Pure, no I/O. */
import { buildScriptPrompt, parseScript, type DocScript, type SceneVisual, type VisualType } from "./script";
import type { TranscriptCue } from "./transcript";

export const VISUAL_TYPES: VisualType[] = ["icons", "flow", "compare", "stat", "list"];

const ANIMATION_SYSTEM = `You are a writer of short animated explainer videos. Turn a video transcript (or pasted text such as a lesson or an article) into a narrated animation script. The narration is written in the language named by the user (e.g. "English"). Reply with ONLY one JSON object, no markdown, in this shape: {"title": string, "scenes": [{"kind": "title"|"point"|"quote"|"takeaways"|"credits", "heading": string, "lines": string[], "narration": string, "visual": "icons"|"flow"|"compare"|"stat"|"list", "icons": string[], "stat": {"value": string, "label": string}, "compare": {"leftTitle": string, "rightTitle": string, "left": string[], "right": string[]}}]}. The first scene is kind "title" and the last is kind "credits". Every other scene is kind "point", except one "takeaways" scene near the end whose lines are 3 to 4 short takeaways, and at most one "quote" scene whose lines[0] is a memorable line taken word for word from the text. Heading is at most 8 words. Lines hold 2 to 4 short on-screen labels of at most 6 words each. For every "point" scene choose the picture that fits the idea, and vary the pictures from scene to scene: "icons" shows each line as an icon with its label (things, features, options); "flow" shows the lines as steps joined by arrows (a process, a cause and its effect, an order); "compare" sets two sides against each other (fill "compare" with two short titles and 1 to 3 short points per side); "stat" shows one big number (fill "stat": "value" is the figure exactly as it appears in the text, such as "50%" or "5.6 billion", and "label" says what it counts; use it only for a number that is in the text); "list" is a plain checklist. "icons" holds one emoji per line, in the same order as lines, chosen to picture that line; give it for every scene that has lines. Leave out "stat" and "compare" in scenes that do not use them. Narration is what the narrator says aloud: plain sentences with no stage directions, no emoji and no markdown. Never invent facts that are not in the text. Write it as a friendly, clear explainer.`;

/** The same request as the documentary's, with the animation instructions as the system prompt. */
export function buildAnimationPrompt(title: string, cues: TranscriptCue[], opts: { minutes: number; language: string }): { system: string; user: string } {
  return { system: ANIMATION_SYSTEM, user: buildScriptPrompt(title, cues, opts).user };
}

/** The first visible character of `s` (an emoji with its joiners counts as one), or "" when there is none. */
export function firstGlyph(s: string): string {
  const t = s.trim();
  if (!t) return "";
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(t)[Symbol.iterator]().next();
    return first.done ? "" : first.value.segment;
  }
  return Array.from(t)[0] ?? "";
}

const text = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const texts = (v: unknown, count: number, max: number): string[] =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === "string" && x.trim() !== "")
    .slice(0, count)
    .map((x) => x.trim().slice(0, max));

/** Reads one scene's picture out of the model's answer; anything unusable becomes a plain list. */
export function parseVisual(item: unknown, lineCount: number): SceneVisual {
  const s = (item && typeof item === "object" ? item : {}) as { visual?: unknown; icons?: unknown; stat?: unknown; compare?: unknown };
  const type: VisualType = VISUAL_TYPES.includes(s.visual as VisualType) ? (s.visual as VisualType) : "list";
  const icons = (Array.isArray(s.icons) ? s.icons : []).slice(0, lineCount).map((x) => (typeof x === "string" ? firstGlyph(x) : ""));
  const out: SceneVisual = { type, icons };
  if (type === "stat") {
    const st = (s.stat && typeof s.stat === "object" ? s.stat : {}) as { value?: unknown; label?: unknown };
    const value = text(st.value, 24);
    if (value) out.stat = { value, label: text(st.label, 80) };
    else out.type = "list";
  }
  if (type === "compare") {
    const c = (s.compare && typeof s.compare === "object" ? s.compare : {}) as { leftTitle?: unknown; rightTitle?: unknown; left?: unknown; right?: unknown };
    const left = texts(c.left, 3, 60);
    const right = texts(c.right, 3, 60);
    if (left.length && right.length) out.compare = { leftTitle: text(c.leftTitle, 30) || "Before", rightTitle: text(c.rightTitle, 30) || "After", left, right };
    else out.type = "list";
  }
  if ((out.type === "icons" || out.type === "flow") && lineCount < 2) out.type = "list";
  return out;
}

/** Reads the model's answer into a script whose every scene has a picture; throws the same plain sentences as parseScript. */
export function parseAnimationScript(raw: string): DocScript {
  const script = parseScript(raw);
  const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)) as { scenes?: unknown };
  // parseScript skips scenes with no narration; skip the same ones here so pictures stay with their scenes.
  const items = (Array.isArray(parsed.scenes) ? parsed.scenes : []).filter((x) => {
    if (!x || typeof x !== "object") return false;
    const narration = (x as { narration?: unknown }).narration;
    return typeof narration === "string" && narration.trim() !== "";
  });
  script.scenes.forEach((scene, i) => {
    scene.visual = parseVisual(items[i], scene.lines.length);
  });
  return script;
}

/** A figure on its way up: countUp("50%", 0.5) is "25%". Text around the number, its decimals and its commas are kept. */
export function countUp(value: string, progress: number): string {
  if (progress >= 1) return value;
  const match = /\d[\d,]*(?:\.\d+)?/.exec(value);
  if (!match) return value;
  const digits = match[0];
  const decimals = digits.includes(".") ? digits.length - digits.indexOf(".") - 1 : 0;
  const now = (Number(digits.replace(/,/g, "")) * Math.max(0, progress)).toFixed(decimals);
  const [whole, fraction] = now.split(".");
  const grouped = digits.includes(",") ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return value.slice(0, match.index) + grouped + (fraction ? `.${fraction}` : "") + value.slice(match.index + digits.length);
}
