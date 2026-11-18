/** When each scene of the film starts and ends, from how long the narrator speaks in it. Pure, no I/O. */
import type { SceneKind } from "./script";

export const FPS = 30;

export interface SceneTiming {
  index: number;
  start: number;
  end: number;
  /** Seconds into the film when the narration of this scene starts. */
  speechStart: number;
  /** Seconds the narrator speaks in this scene. */
  speech: number;
}

export interface FilmTimeline {
  scenes: SceneTiming[];
  total: number;
}

/** Quiet time before the narrator begins, so the heading can land first. */
export const leadFor = (kind: SceneKind): number => (kind === "title" ? 1.2 : 0.6);
/** Quiet time after the narrator ends. */
export const tailFor = (kind: SceneKind): number => (kind === "credits" ? 2 : 0.7);

export function buildTimeline(scenes: { kind: SceneKind }[], speechSeconds: number[]): FilmTimeline {
  let at = 0;
  const out: SceneTiming[] = scenes.map((scene, index) => {
    const speech = Math.max(0, speechSeconds[index] ?? 0);
    const lead = leadFor(scene.kind);
    const start = at;
    const end = start + lead + speech + tailFor(scene.kind);
    at = end;
    return { index, start, end, speechStart: start + lead, speech };
  });
  return { scenes: out, total: at };
}

/** The scene on screen at time `t` (the last one once `t` runs past the end). */
export function sceneAt(tl: FilmTimeline, t: number): SceneTiming {
  for (const s of tl.scenes) if (t < s.end) return s;
  return tl.scenes[tl.scenes.length - 1];
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

/** 0 before `at`, easing out to 1 over `dur` seconds. */
export function reveal(local: number, at: number, dur = 0.55): number {
  const x = clamp01((local - at) / dur);
  return 1 - (1 - x) ** 3;
}

/** Scene-local seconds at which each of `count` on-screen lines appears: spread across the narration. */
export function lineRevealTimes(timing: SceneTiming, count: number, kind: SceneKind): number[] {
  const lead = leadFor(kind);
  const span = Math.max(0.5, timing.speech * 0.75);
  return Array.from({ length: count }, (_, i) => lead * 0.6 + (count > 1 ? (span * i) / count : 0));
}

/**
 * Narration cut into short pieces for the voice (a long text in one go makes a small voice
 * model stumble): sentence by sentence, tiny fragments joined to the next, long ones split at a comma or space.
 */
export function splitSentences(text: string, maxLen = 220): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…])\s+/).filter(Boolean);
  const merged: string[] = [];
  for (const s of sentences) {
    const last = merged[merged.length - 1];
    if (last !== undefined && (last.length < 25 || s.length < 25)) merged[merged.length - 1] = `${last} ${s}`;
    else merged.push(s);
  }
  const out: string[] = [];
  for (let piece of merged) {
    while (piece.length > maxLen) {
      const window = piece.slice(0, maxLen);
      const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" "));
      const at = cut > maxLen / 3 ? cut + 1 : maxLen;
      out.push(piece.slice(0, at).trim());
      piece = piece.slice(at).trim();
    }
    if (piece) out.push(piece);
  }
  return out;
}
