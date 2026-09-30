/**
 * Turns the local AI's highlights into finished reels: each pick becomes its
 * own small project (source clip re-encoded to just that range, captions
 * carried over and shifted, the source's frame format and caption style, and
 * face tracking on landscape sources) tagged with the source project's id so
 * the Subtitles panel can list them under "Reels".
 */
import { createClip, createProject, type CaptionCue, type Clip, type ReelInfo, type VideoProject } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";
import { fitZoom } from "@/lib/models/clipOps";
import { getAsset, listProjects, saveProject } from "@/lib/storage/db";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { ffmpegEngine } from "@/lib/ffmpegEngine";
import { autoReframe } from "@/lib/tracking/autoReframe";
import { activeModel, findAiHighlights, type AiSettings } from "./aiHighlights";
import type { Highlight } from "./highlights";
import { uid } from "@/lib/utils/id";

/** Count and length the user last chose, shared by the Reels and Subtitles panels. */
export interface ReelSettings {
  count: 3 | 5 | 8 | 12;
  targetSeconds: 15 | 30 | 60;
}
export const REEL_COUNTS: ReelSettings["count"][] = [3, 5, 8, 12];
const REEL_SETTINGS_KEY = "reelflow.reels";
/** Bumped when the default count changes, so a count saved under the old default is reset once. */
const REEL_SETTINGS_VERSION = 2;
export const DEFAULT_REEL_SETTINGS: ReelSettings = { count: 12, targetSeconds: 30 };

export function loadReelSettings(): ReelSettings {
  try {
    const raw = localStorage.getItem(REEL_SETTINGS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<ReelSettings> & { v?: number }) : {};
    const current = parsed.v === REEL_SETTINGS_VERSION;
    return {
      count: current && REEL_COUNTS.includes(parsed.count as ReelSettings["count"]) ? (parsed.count as ReelSettings["count"]) : DEFAULT_REEL_SETTINGS.count,
      targetSeconds: [15, 30, 60].includes(parsed.targetSeconds as number) ? (parsed.targetSeconds as ReelSettings["targetSeconds"]) : DEFAULT_REEL_SETTINGS.targetSeconds,
    };
  } catch {
    return { ...DEFAULT_REEL_SETTINGS };
  }
}

export function saveReelSettings(settings: ReelSettings): void {
  try {
    localStorage.setItem(REEL_SETTINGS_KEY, JSON.stringify({ ...settings, v: REEL_SETTINGS_VERSION }));
  } catch {
    /* storage unavailable */
  }
}

/** Air kept before the first word and after the last, seconds. */
export const REEL_PADDING = 0.4;

/** Widens a range by the padding, inside [0, total]. */
export function padRange(start: number, end: number, total: number, padding = REEL_PADDING): { start: number; end: number } {
  return { start: Math.max(0, start - padding), end: Math.min(total, end + padding) };
}

/** Cues that fall inside the range, shifted so the range starts at 0 and clipped to it. */
export function cuesForRange(cues: CaptionCue[], start: number, end: number): CaptionCue[] {
  const out: CaptionCue[] = [];
  for (const c of cues) {
    if (c.end <= start || c.start >= end) continue;
    const copy = structuredClone(c);
    copy.id = uid("cue");
    copy.start = Math.max(0, c.start - start);
    copy.end = Math.min(end - start, c.end - start);
    if (copy.words) copy.words = copy.words.map((w) => ({ ...w, start: Math.max(0, w.start - start), end: Math.min(end - start, w.end - start) })).filter((w) => w.end > w.start);
    if (copy.end - copy.start >= 0.15) out.push(copy);
  }
  return out;
}

/** True when the range overlaps a reel that already exists for the source. */
export function overlapsExisting(start: number, end: number, existing: Pick<ReelInfo, "start" | "end">[]): boolean {
  const len = end - start;
  return existing.some((r) => Math.min(end, r.end) - Math.max(start, r.start) > len * 0.5);
}

export function reelName(sourceName: string, index: number, title: string): string {
  const t = title.trim().replace(/\s+/g, " ").slice(0, 60);
  return `${sourceName} · Reel ${index} · ${t || "Untitled"}`;
}

/** Reels already cut from `sourceId`, in order. */
export async function listReels(sourceId: string): Promise<VideoProject[]> {
  const all = await listProjects();
  return all.filter((p) => p.sourceProjectId === sourceId && p.reel).sort((a, b) => (a.reel!.index ?? 0) - (b.reel!.index ?? 0));
}

export interface MakeReelsOptions {
  project: VideoProject;
  count: number;
  targetSeconds: number;
  settings: AiSettings;
  onProgress?: (message: string, progress: number | null) => void;
  signal?: AbortSignal;
}

export interface MakeReelsResult {
  made: VideoProject[];
  skipped: number;
  found: number;
}

const abortError = () => new DOMException("Cancelled", "AbortError");

/** Re-encodes one range of a clip's source file into a small MP4 at the source resolution. */
async function trimMedia(blob: Blob, sourceStart: number, seconds: number, signal?: AbortSignal): Promise<Blob> {
  await ffmpegEngine.load();
  const mounted = await ffmpegEngine.mountInputs([{ name: "reel_src.bin", blob }]);
  const out = `/reel_${Date.now().toString(36)}.mp4`;
  try {
    if (signal?.aborted) throw abortError();
    const code = await ffmpegEngine.exec([
      "-hide_banner", "-y",
      "-ss", sourceStart.toFixed(3), "-t", seconds.toFixed(3), "-i", mounted.inputPath("reel_src.bin"),
      "-map", "0:v:0", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
      "-movflags", "+faststart", out,
    ]);
    if (code !== 0) throw new Error(`Could not cut the reel.\n${ffmpegEngine.recentLogs()}`);
    const data = (await ffmpegEngine.instance.readFile(out)) as Uint8Array;
    return new Blob([new Uint8Array(data)], { type: "video/mp4" });
  } finally {
    // The worker may be gone after a crash; cleanup must not mask the real error.
    try {
      await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
    } catch {
      /* engine already recycled */
    }
    await mounted.release().catch(() => undefined);
  }
}

/** Builds one reel project from a highlight of the source project. */
async function makeReel(source: VideoProject, h: Highlight, index: number, o: MakeReelsOptions): Promise<VideoProject> {
  const layouts = layoutClips(source.clips);
  const total = layouts[layouts.length - 1].end;
  const { start, end } = padRange(h.start, h.end, total);
  // Reels are cut from a single clip: the one under the highlight's start.
  const loc = locateFrame(layouts, start + 0.01);
  if (!loc) throw new Error("The highlight is outside the timeline.");
  const layout = loc.primary;
  const clipEnd = Math.min(end, layout.end);
  const sourceStart = toSourceTime(layout, start);
  const sourceEnd = toSourceTime(layout, clipEnd);
  const seconds = Math.max(1, sourceEnd - sourceStart);
  const asset = await getAsset(layout.clip.assetId);
  if (!asset) throw new Error("The source video is missing from local storage.");

  o.onProgress?.(`Cutting reel ${index}: ${h.title ?? "clip"} (${Math.round(seconds)} s)`, null);
  const media = await trimMedia(asset.blob, sourceStart, seconds, o.signal);
  if (o.signal?.aborted) throw abortError();

  const title = h.title ?? h.text.slice(0, 40);
  const reel = createProject({ name: reelName(source.name, index, title), formatId: source.formatId });
  reel.safeZone = source.safeZone;
  reel.subtitleStyle = structuredClone(source.subtitleStyle);
  reel.captions = structuredClone(source.captions);
  reel.sourceProjectId = source.id;
  reel.reel = { index, title, score: h.score, hook: h.hook, start, end: clipEnd };
  await saveProject(reel);

  const file = new File([media], `${reel.name.replace(/[\\/:*?"<>|]+/g, " ")}.mp4`, { type: "video/mp4" });
  const { clip, blob } = await importVideo(file, reel.id, (m) => o.onProgress?.(`Reel ${index}: ${m}`, null));
  const source0 = layout.clip;
  const finished: Clip = { ...clip, ...(source0.look ? { look: structuredClone(source0.look) } : {}), background: source0.background };
  const frame = getFormat(reel.formatId);
  const landscape = clip.width > clip.height && frame.height > frame.width;
  if (landscape) {
    o.onProgress?.(`Reel ${index}: following the face`, null);
    try {
      const url = URL.createObjectURL(blob);
      try {
        const keyframes = await autoReframe({ videoUrl: url, clip: finished, frame: { width: frame.width, height: frame.height }, signal: o.signal, onProgress: (m) => o.onProgress?.(`Reel ${index}: ${m}`, null) });
        finished.reframe = { keyframes, label: "Face tracking" };
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") throw e;
      // No face found: fall back to fitting the whole picture in the frame.
      finished.zoom = fitZoom({ width: clip.width, height: clip.height }, { width: frame.width, height: frame.height });
    }
  }
  reel.clips = [finished];
  reel.cues = cuesForRange(source.cues, start, clipEnd);
  await saveProject(reel);
  await updateProjectThumbnail(reel.id, blob, Math.min(1, clip.duration / 2));
  return reel;
}

/** Finds the best moments with the chosen model (Ollama by default) and cuts each into its own reel project. */
export async function makeReels(o: MakeReelsOptions): Promise<MakeReelsResult> {
  const { project } = o;
  if (!project.clips.length) throw new Error("Add a video first.");
  if (!project.cues.length) throw new Error("Generate captions first; the model reads the transcript.");
  o.onProgress?.(`Asking ${activeModel(o.settings)} for the ${o.count} best moments`, null);
  const highlights = await findAiHighlights(project.cues, {
    settings: o.settings,
    count: o.count,
    minSeconds: Math.max(8, Math.round(o.targetSeconds * 0.8)),
    maxSeconds: Math.round(o.targetSeconds * 1.2),
    signal: o.signal,
    onProgress: (m) => o.onProgress?.(m, null),
  });
  const existing = await listReels(project.id);
  let index = existing.reduce((m, r) => Math.max(m, r.reel?.index ?? 0), 0);
  const made: VideoProject[] = [];
  let skipped = 0;
  for (const [i, h] of highlights.entries()) {
    if (o.signal?.aborted) throw abortError();
    if (overlapsExisting(h.start, h.end, [...existing, ...made].map((r) => r.reel!))) {
      skipped++;
      continue;
    }
    o.onProgress?.(`Reel ${i + 1} of ${highlights.length}`, (i + 0.1) / highlights.length);
    index++;
    made.push(await makeReel(project, h, index, o));
    o.onProgress?.(`Reel ${i + 1} of ${highlights.length} done`, (i + 1) / highlights.length);
  }
  return { made, skipped, found: highlights.length };
}

/** Keeps helper types close to the module for callers. */
export type { Highlight };
export { createClip };
