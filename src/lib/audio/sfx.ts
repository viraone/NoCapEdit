/**
 * Built-in sound effects (synthesised, public domain, shipped in public/sfx).
 * An effect becomes a project asset the first time it is used, then lives on
 * the timeline as a voice-over entry of kind "sfx" so preview and export mix
 * it like any other timed audio.
 */
import type { VideoProject, Voiceover } from "@/lib/models/project";
import { listProjectAssets, putAsset } from "@/lib/storage/db";
import { withBase } from "@/lib/basePath";
import { uid } from "@/lib/utils/id";

export interface Sfx {
  id: string;
  name: string;
  file: string;
  duration: number;
}

export const SFX_LIBRARY: Sfx[] = [
  { id: "pop", name: "Pop", file: "/sfx/pop.mp3", duration: 0.18 },
  { id: "click", name: "Click", file: "/sfx/click.mp3", duration: 0.06 },
  { id: "whoosh", name: "Whoosh", file: "/sfx/whoosh.mp3", duration: 0.6 },
  { id: "swoosh", name: "Swoosh", file: "/sfx/swoosh.mp3", duration: 0.6 },
  { id: "ding", name: "Ding", file: "/sfx/ding.mp3", duration: 1.0 },
  { id: "rise", name: "Rise", file: "/sfx/rise.mp3", duration: 0.7 },
  { id: "thud", name: "Thud", file: "/sfx/thud.mp3", duration: 0.5 },
];

const previews = new Map<string, HTMLAudioElement>();

export function previewSfx(sfx: Sfx) {
  let a = previews.get(sfx.id);
  if (!a) {
    a = new Audio(withBase(sfx.file));
    previews.set(sfx.id, a);
  }
  a.currentTime = 0;
  a.play().catch(() => undefined);
}

const assetCache = new Map<string, string>();

/** Returns the asset id for an effect inside a project, importing it once. */
export async function ensureSfxAsset(projectId: string, sfx: Sfx): Promise<{ assetId: string; blob: Blob; created: boolean }> {
  const key = `${projectId}:${sfx.id}`;
  const name = `sfx:${sfx.id}`;
  const existing = await listProjectAssets(projectId);
  const found = existing.find((a) => a.name === name);
  if (found) {
    assetCache.set(key, found.id);
    return { assetId: found.id, blob: found.blob, created: false };
  }
  const res = await fetch(withBase(sfx.file));
  if (!res.ok) throw new Error(`Could not load the ${sfx.name} sound.`);
  const blob = await res.blob();
  const assetId = uid("asset");
  await putAsset({ id: assetId, projectId, name, type: "audio/mpeg", size: blob.size, blob, createdAt: Date.now() });
  assetCache.set(key, assetId);
  return { assetId, blob, created: true };
}

export function makeSfxClip(sfx: Sfx, assetId: string, start: number, volume: number): Voiceover {
  return { id: uid("sfx"), kind: "sfx", assetId, name: sfx.name, text: sfx.name, start, duration: sfx.duration, volume };
}

/** Places the effect at the start of every caption cue (skipping near-duplicates). */
export function sfxOnCaptions(project: VideoProject, sfx: Sfx, assetId: string, volume: number): number {
  const starts = [...new Set(project.cues.map((c) => Math.round(c.start * 100) / 100))].sort((a, b) => a - b);
  let last = -Infinity;
  let n = 0;
  for (const t of starts) {
    if (t - last < 0.35) continue;
    project.voiceovers.push(makeSfxClip(sfx, assetId, t, volume));
    last = t;
    n++;
  }
  return n;
}
