/**
 * The pure half of the documentary script writer: the prompt sent to a language model
 * and the strict reader for its answer. No network here; src/lib/documentary/ai.ts makes the call.
 */
import { cuesToText, type TranscriptCue } from "./transcript";

export type SceneKind = "title" | "point" | "quote" | "takeaways" | "credits";

/** How the animation style pictures a scene. */
export type VisualType = "icons" | "flow" | "compare" | "stat" | "list";

export interface SceneVisual {
  type: VisualType;
  /** One emoji per on-screen line, in the same order ("" where there is none). */
  icons: string[];
  /** For "stat": the big figure and what it counts. */
  stat?: { value: string; label: string };
  /** For "compare": the two sides. */
  compare?: { leftTitle: string; rightTitle: string; left: string[]; right: string[] };
}

export interface DocScene {
  id: string;
  kind: SceneKind;
  heading: string;
  /** Short on-screen phrases. */
  lines: string[];
  /** What the narrator says aloud. */
  narration: string;
  /** Set by the animation style: how the scene is pictured. */
  visual?: SceneVisual;
}

export interface DocScript {
  title: string;
  scenes: DocScene[];
}

export const SCENE_KINDS: SceneKind[] = ["title", "point", "quote", "takeaways", "credits"];
export const MAX_TRANSCRIPT_CHARS = 60000;

const SYSTEM = `You are a documentary writer. Turn a video transcript (or pasted text such as a lesson or an article) into a short narrated documentary script. The narration is written in the language named by the user (e.g. "English"). Reply with ONLY one JSON object, no markdown, in this shape: {"title": string, "scenes": [{"kind": "title"|"point"|"quote"|"takeaways"|"credits", "heading": string, "lines": string[], "narration": string}]}. The first scene is kind "title" and the last is kind "credits". Use "point" for the main ideas (one idea per scene), "quote" for one memorable line taken word for word from the transcript (put it in lines[0]), and one "takeaways" scene near the end whose lines are 3 to 4 short takeaways. Heading is at most 8 words. Lines hold 0 to 4 short on-screen phrases of at most 12 words each. Narration is what the narrator says aloud: plain sentences with no stage directions, no emoji and no markdown. Never invent facts that are not in the transcript. Write it as a calm, clear documentary narrator.`;

export function buildScriptPrompt(title: string, cues: TranscriptCue[], opts: { minutes: number; language: string }): { system: string; user: string } {
  let text = cuesToText(cues);
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    const head = Math.round(MAX_TRANSCRIPT_CHARS * 0.6);
    const tail = MAX_TRANSCRIPT_CHARS - head;
    text = `${text.slice(0, head)}\n\n[... middle of the transcript left out ...]\n\n${text.slice(text.length - tail)}`;
  }
  const words = Math.max(140, Math.round(opts.minutes * 140));
  const user = `Video title: ${title}\nTarget narration length: about ${words} words in total across all scenes.\nNarration language: ${opts.language}\n\nTranscript:\n${text}`;
  return { system: SYSTEM, user };
}

/** Reads the model's answer into a script; throws a plain sentence when it isn't one. */
export function parseScript(raw: string): DocScript {
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  let parsed: { title?: unknown; scenes?: unknown };
  try {
    if (first === -1 || last <= first) throw new Error("no object");
    parsed = JSON.parse(raw.slice(first, last + 1));
  } catch {
    throw new Error("The AI's answer wasn't a script. Try again.");
  }
  const title = typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : "Documentary";
  const scenes: DocScene[] = [];
  for (const item of Array.isArray(parsed.scenes) ? parsed.scenes : []) {
    if (!item || typeof item !== "object") continue;
    const s = item as { kind?: unknown; heading?: unknown; lines?: unknown; narration?: unknown };
    if (typeof s.narration !== "string" || !s.narration.trim()) continue;
    const kind = SCENE_KINDS.includes(s.kind as SceneKind) ? (s.kind as SceneKind) : "point";
    const lines = (Array.isArray(s.lines) ? s.lines : [])
      .filter((l): l is string => typeof l === "string" && l.trim() !== "")
      .slice(0, 4)
      .map((l) => l.trim().slice(0, 120));
    scenes.push({
      id: `s${scenes.length + 1}`,
      kind,
      heading: typeof s.heading === "string" ? s.heading.trim().slice(0, 80) : "",
      lines,
      narration: s.narration.trim(),
    });
  }
  if (scenes.length < 2) throw new Error("The AI's script was too short. Try again.");
  return { title, scenes };
}

export function narrationWords(script: DocScript): number {
  return script.scenes.reduce((n, s) => n + (s.narration.trim() ? s.narration.trim().split(/\s+/).length : 0), 0);
}
