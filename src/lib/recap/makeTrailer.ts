import { createProject, type CaptionCue, type Clip, type VideoProject } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { layoutClips, locateFrame, toSourceTime } from "@/lib/models/timeline";
import { fitZoom } from "@/lib/models/clipOps";
import { deleteProject, getAsset, saveProject } from "@/lib/storage/db";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { autoReframe } from "@/lib/tracking/autoReframe";
import { uid } from "@/lib/utils/id";
import { whileBusy } from "@/lib/utils/busy";
import { cuesForRange } from "@/lib/edit/reelMaker";
import { trailerRanges, type Range } from "./trailerRanges";
import { cutPieces, type Piece } from "./cutPieces";
import { oneWordCues, trailerOverlays } from "./trailerDressing";

export interface TrailerOptions {
  source: VideoProject;
  laughs: { start: number; end: number }[];
  signal?: AbortSignal;
  onProgress?: (message: string, progress: number | null) => void;
  nameAt?: (sourceProjectTime: number) => string;
  closing?: string;
  /** An already trimmed short video to play before the kept moments. */
  opener?: Blob;
}

const abortError = () => new DOMException("Cancelled", "AbortError");

export function makeTrailer(o: TrailerOptions): Promise<VideoProject> {
  return whileBusy(() => makeTrailerInner(o));
}

async function makeTrailerInner(o: TrailerOptions): Promise<VideoProject> {
  const { source, laughs, signal, onProgress } = o;
  if (!laughs.length) throw new Error("Keep at least one moment first.");

  const layouts = layoutClips(source.clips);
  const duration = layouts[layouts.length - 1]?.end ?? 0;
  const ranges = trailerRanges(laughs, source.cues, duration);

  const pieces: Piece[] = [];
  const rangeLayouts: { layout: Clip; range: Range }[] = [];
  let firstAssetId: string | null = null;

  for (const range of ranges) {
    const loc = locateFrame(layouts, range.start + 0.01);
    if (!loc) continue;
    const layout = loc.primary;
    const end = Math.min(range.end, layout.end);
    if (firstAssetId === null) firstAssetId = layout.clip.assetId;
    else if (layout.clip.assetId !== firstAssetId) throw new Error("Keep moments from one video at a time.");

    const start = toSourceTime(layout, range.start);
    const seconds = toSourceTime(layout, end) - start;
    if (seconds <= 0) continue;
    pieces.push({ start, seconds });
    rangeLayouts.push({ layout: layout.clip, range: { start: range.start, end } });
  }

  if (!pieces.length || !firstAssetId) throw new Error("Keep at least one moment first.");

  const asset = await getAsset(firstAssetId);
  if (!asset) throw new Error("The source video is missing from local storage.");

  const media = await cutPieces(asset.blob, pieces, {
    signal,
    onStatus: (m) => onProgress?.(m, null),
    onProgress: (f) => onProgress?.("Cutting the moments", f),
  });
  if (signal?.aborted) throw abortError();

  const trailer = createProject({ name: `${source.name} trailer`, formatId: source.formatId });
  trailer.safeZone = source.safeZone;
  trailer.subtitleStyle = structuredClone(source.subtitleStyle);
  trailer.captions = structuredClone(source.captions);
  // Not tagged with sourceProjectId: that marks a reel, which the start screen files away under its source.

  try {
    let openerClip: Clip | null = null;
    if (o.opener) {
      onProgress?.("Adding the opening shot", null);
      const openerFile = new File([o.opener], "opener.mp4", { type: "video/mp4" });
      const opened = await importVideo(openerFile, trailer.id, (m) => onProgress?.(m, null));
      openerClip = opened.clip;
    }
    // Everything after the opener starts this much later.
    const openerLength = openerClip ? Math.max(0, openerClip.outPoint - openerClip.inPoint) : 0;

    const file = new File([media], "trailer.mp4", { type: "video/mp4" });
    const { clip, blob } = await importVideo(file, trailer.id, (m) => onProgress?.(m, null));

    const clips: Clip[] = [];
    const offsets: number[] = [];
    const madeRanges: Range[] = [];
    let offset = 0;
    for (let i = 0; i < pieces.length; i++) {
      const seconds = pieces[i].seconds;
      const inPoint = offset;
      const outPoint = Math.min(clip.duration, offset + seconds);
      if (outPoint - inPoint < 0.1) {
        offsets.push(offset);
        offset += seconds;
        continue;
      }
      const sourceClip = rangeLayouts[i].layout;
      const c: Clip = {
        ...clip,
        id: i === 0 ? clip.id : uid("clip"),
        inPoint,
        outPoint,
        ...(sourceClip.look ? { look: structuredClone(sourceClip.look) } : {}),
        background: sourceClip.background,
      };
      clips.push(c);
      offsets.push(offset);
      madeRanges.push(rangeLayouts[i].range);
      offset += seconds;
    }

    const frame = getFormat(trailer.formatId);
    const count = clips.length;
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw abortError();
      const c = clips[i];
      const landscape = c.width > c.height && frame.height > frame.width;
      onProgress?.("Following the face", i / count);
      try {
        const url = URL.createObjectURL(blob);
        try {
          const keyframes = await autoReframe({
            videoUrl: url,
            clip: c,
            frame: { width: frame.width, height: frame.height },
            signal,
            onProgress: (m) => onProgress?.(m, null),
          });
          c.reframe = { keyframes, label: "Face tracking" };
        } finally {
          URL.revokeObjectURL(url);
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        if (landscape) c.zoom = fitZoom({ width: c.width, height: c.height }, { width: frame.width, height: frame.height });
      }
    }

    trailer.clips = openerClip ? [openerClip, ...clips] : clips;
    const cues: CaptionCue[] = [];
    for (let i = 0; i < rangeLayouts.length; i++) {
      const { range } = rangeLayouts[i];
      const pieceCues = cuesForRange(source.cues, range.start, range.end);
      const off = offsets[i] + openerLength;
      for (const cue of pieceCues) {
        const copy = structuredClone(cue);
        copy.start += off;
        copy.end += off;
        if (copy.words) copy.words = copy.words.map((w) => ({ ...w, start: w.start + off, end: w.end + off }));
        cues.push(copy);
      }
    }
    trailer.cues = oneWordCues(cues);

    const trailerPieces = clips.map((c, i) => {
      const range = madeRanges[i];
      const middle = (range.start + range.end) / 2;
      return { start: c.inPoint + openerLength, end: c.outPoint + openerLength, name: o.nameAt?.(middle) ?? "" };
    });
    trailer.overlays = trailerOverlays(trailerPieces, o.closing ?? "");

    await saveProject(trailer);
    await updateProjectThumbnail(trailer.id, blob, 1);
    return trailer;
  } catch (e) {
    await deleteProject(trailer.id).catch(() => undefined);
    throw e;
  }
}
