/**
 * Turns the local AI's highlights into finished reels: each pick becomes its
 * own small project (source clip re-encoded to that range plus REEL_HANDLE
 * seconds of slack on each side, captions carried over and shifted, the
 * source's frame format and caption style, and face tracking on landscape
 * sources) tagged with the source project's id so the Subtitles panel can
 * list them under "Reels". The slack lets the reel's clip be dragged out on
 * the timeline; reelStretch cuts more from the source past it.
 */
import { createClip, createProject, type CaptionCue, type Clip, type ReelInfo, type VideoProject } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";
import { fitZoom } from "@/lib/models/clipOps";
import { deleteProject, getAsset, listProjects, saveProject } from "@/lib/storage/db";
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

/**
 * Slack cut on each side of a reel, seconds: the media file holds this much
 * of the source before and after what the reel shows, so its clip can be
 * dragged out on the timeline without going back to the source. Past it the
 * reel is cut again (see reelStretch).
 */
export const REEL_HANDLE = 10;

/** The media window for a shown range: the range plus the slack on each side, inside the source clip's bounds. */
export function mediaWindow(range: { start: number; end: number }, bounds: { start: number; end: number }, handle = REEL_HANDLE): { start: number; end: number } {
  return { start: Math.max(bounds.start, range.start - handle), end: Math.min(bounds.end, range.end + handle) };
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

/** A reel project whose cut never finished: it was created, but no clip landed in it. */
export function isEmptyReel(p: Pick<VideoProject, "reel" | "clips">): boolean {
  return !!p.reel && p.clips.length === 0;
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

export interface TrimMediaOptions {
  signal?: AbortSignal;
  /** Share of the cut done so far, 0..1, from ffmpeg's time reports. */
  onProgress?: (fraction: number) => void;
}

/** Re-encodes one range of a clip's source file into a small MP4 at the source resolution. Cancelling stops ffmpeg at once. */
export async function trimMedia(blob: Blob, sourceStart: number, seconds: number, o: TrimMediaOptions = {}): Promise<Blob> {
  const { signal, onProgress } = o;
  await ffmpegEngine.load();
  const mounted = await ffmpegEngine.mountInputs([{ name: "reel_src.bin", blob }]);
  const out = `/reel_${Date.now().toString(36)}.mp4`;
  const onAbort = () => ffmpegEngine.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    if (signal?.aborted) throw abortError();
    const code = await ffmpegEngine.exec(
      [
        "-hide_banner", "-y",
        "-ss", sourceStart.toFixed(3), "-t", seconds.toFixed(3), "-i", mounted.inputPath("reel_src.bin"),
        "-map", "0:v:0", "-map", "0:a?",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart", out,
      ],
      onProgress && ((t) => onProgress(Math.min(1, t / Math.max(0.001, seconds)))),
    );
    if (signal?.aborted) throw abortError();
    if (code !== 0) throw new Error(`Could not cut the reel.\n${ffmpegEngine.recentLogs()}`);
    const data = (await ffmpegEngine.instance.readFile(out)) as Uint8Array;
    return new Blob([new Uint8Array(data)], { type: "video/mp4" });
  } catch (e) {
    // A cancel terminates the worker, which surfaces as its own error; report the cancel instead.
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // The worker may be gone after a crash; cleanup must not mask the real error.
    try {
      await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
    } catch {
      /* engine already recycled */
    }
    await mounted.release().catch(() => undefined);
  }
}

/** Cuts the reel's stored range out of the source into the reel project: media, framing, captions and thumbnail. */
async function fillReel(source: VideoProject, reel: VideoProject, o: Pick<MakeReelsOptions, "onProgress" | "signal">): Promise<VideoProject> {
  const info = reel.reel!;
  const index = info.index;
  const layouts = layoutClips(source.clips);
  // Reels are cut from a single clip: the one under the range's start.
  const loc = locateFrame(layouts, info.start + 0.01);
  if (!loc) throw new Error("The highlight is outside the timeline.");
  const layout = loc.primary;
  // What the reel shows, and the wider window the media file covers (slack on
  // each side, so the reel can be stretched on the timeline later).
  const shown = { start: info.start, end: Math.min(info.end, layout.end) };
  const covered = mediaWindow(shown, { start: layout.start, end: layout.end });
  const sourceStart = toSourceTime(layout, covered.start);
  const sourceEnd = toSourceTime(layout, covered.end);
  const seconds = Math.max(1, sourceEnd - sourceStart);
  const asset = await getAsset(layout.clip.assetId);
  if (!asset) throw new Error("The source video is missing from local storage.");

  const label = `Cutting reel ${index}: ${info.title || "clip"} (${Math.round(shown.end - shown.start)} s, plus room to stretch)`;
  o.onProgress?.(label, null);
  const media = await trimMedia(asset.blob, sourceStart, seconds, { signal: o.signal, onProgress: (f) => o.onProgress?.(label, f) });
  if (o.signal?.aborted) throw abortError();

  const file = new File([media], `${reel.name.replace(/[\\/:*?"<>|]+/g, " ")}.mp4`, { type: "video/mp4" });
  const { clip, blob } = await importVideo(file, reel.id, (m) => o.onProgress?.(`Reel ${index}: ${m}`, null));
  const source0 = layout.clip;
  // The clip is trimmed to the shown range inside the media; the slack sits outside its in/out points.
  const inPoint = Math.min(shown.start - covered.start, Math.max(0, clip.duration - 0.1));
  const outPoint = Math.max(inPoint + 0.1, Math.min(clip.duration, shown.end - covered.start));
  const finished: Clip = { ...clip, inPoint, outPoint, ...(source0.look ? { look: structuredClone(source0.look) } : {}), background: source0.background };
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
  reel.cues = cuesForRange(source.cues, shown.start, shown.end);
  reel.reel = { ...info, end: shown.end, media: covered };
  await saveProject(reel);
  await updateProjectThumbnail(reel.id, blob, inPoint + Math.min(1, (outPoint - inPoint) / 2));
  return reel;
}

/** Builds one reel project from a highlight of the source project. A failed or cancelled cut leaves nothing behind. */
async function makeReel(source: VideoProject, h: Highlight, index: number, o: MakeReelsOptions): Promise<VideoProject> {
  const layouts = layoutClips(source.clips);
  const total = layouts[layouts.length - 1].end;
  const { start, end } = padRange(h.start, h.end, total);
  const title = h.title ?? h.text.slice(0, 40);
  const reel = createProject({ name: reelName(source.name, index, title), formatId: source.formatId });
  reel.safeZone = source.safeZone;
  reel.subtitleStyle = structuredClone(source.subtitleStyle);
  reel.captions = structuredClone(source.captions);
  reel.sourceProjectId = source.id;
  reel.reel = { index, title, score: h.score, hook: h.hook, start, end };
  await saveProject(reel);
  try {
    return await fillReel(source, reel, o);
  } catch (e) {
    await deleteProject(reel.id).catch(() => undefined);
    throw e;
  }
}

export interface RecutOptions {
  source: VideoProject;
  reel: VideoProject;
  onProgress?: MakeReelsOptions["onProgress"];
  signal?: AbortSignal;
}

/** Cuts an empty reel again from the range it remembers, without asking the model. */
export async function recutReel(o: RecutOptions): Promise<VideoProject> {
  if (!o.reel.reel || o.reel.sourceProjectId !== o.source.id) throw new Error("This project isn't a reel of that video.");
  if (!o.source.clips.length) throw new Error("The source video has no clips to cut from.");
  return fillReel(o.source, structuredClone(o.reel), o);
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
