/**
 * The "Editor timeline" package: a zip with the project as FCPXML (Final Cut
 * Pro, DaVinci Resolve) and xmeml (Premiere Pro, DaVinci Resolve), every media
 * file the timeline uses, the captions as .srt and a short how-to-open note.
 * Nothing is re-encoded: the media goes in as it was imported, so opening the
 * package is quick and loses no quality.
 */
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from "fflate";
import type { VideoProject } from "@/lib/models/project";
import { toSrt } from "@/lib/captions/srt";
import { safeFilename } from "@/lib/utils/download";
import type { AssetRecord } from "@/lib/storage/db";
import { buildFcpxml, buildXmeml, planNle, type NleMedia, type NlePlan } from "./nle";

export interface BundleSink {
  write(chunk: Uint8Array): Promise<void> | void;
}

export interface BundleResult {
  plan: NlePlan;
  files: number;
  bytes: number;
}

const MIME_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/ogg": "ogg",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

/** The extension a stored file keeps in the package: its own, else the one its type implies. */
export function mediaExtension(record: Pick<AssetRecord, "name" | "type">, fallback: string): string {
  const own = record.name.match(/\.([A-Za-z0-9]{2,5})$/)?.[1]?.toLowerCase();
  return own ?? MIME_EXT[record.type] ?? fallback;
}

/** Every asset id the timeline needs, with what it is: where it sits in the file table needs its kind and length. */
export function timelineAssets(project: VideoProject): { id: string; kind: "video" | "audio"; name: string; duration: number; clip?: VideoProject["clips"][number] }[] {
  const seen = new Map<string, { id: string; kind: "video" | "audio"; name: string; duration: number; clip?: VideoProject["clips"][number] }>();
  const add = (e: { id: string; kind: "video" | "audio"; name: string; duration: number; clip?: VideoProject["clips"][number] }) => {
    if (!seen.has(e.id)) seen.set(e.id, e);
  };
  for (const c of project.clips) {
    add({ id: c.assetId, kind: "video", name: c.name, duration: c.duration, clip: c });
    if (c.audioAssetId) add({ id: c.audioAssetId, kind: "audio", name: c.audioLabel || `${c.name} (cleaned)`, duration: c.duration });
  }
  if (project.music) add({ id: project.music.assetId, kind: "audio", name: project.music.name, duration: project.music.duration });
  for (const v of project.voiceovers) add({ id: v.assetId, kind: "audio", name: v.name || "Voice-over", duration: v.duration });
  return [...seen.values()];
}

function readMe(name: string, plan: NlePlan, hasCaptions: boolean): string {
  const lines = [
    `${name}: timeline from NoCap Edit`,
    "",
    "Open it",
    "  Final Cut Pro      File > Import > XML…, choose the .fcpxml file.",
    "  DaVinci Resolve    File > Import > Timeline…, choose the .fcpxml file (or the .xml one).",
    "  Premiere Pro       File > Import…, choose the .xml file (it opens as a sequence).",
    "",
    "Unzip the folder first and keep the media folder next to the timeline files.",
    "If the editor says media is offline, use its Relink Files command and point it at the media folder.",
    "",
    `Timeline: ${plan.width}×${plan.height}, ${plan.fps} fps.`,
  ];
  if (hasCaptions) lines.push("The captions are also in the .srt file; import it as subtitles/captions in the editor to get them as caption tracks.");
  if (plan.notes.length) {
    lines.push("", "Not exactly as in NoCap Edit:");
    for (const n of plan.notes) lines.push(`  - ${n}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function pump(blob: Blob, file: ZipPassThrough) {
  const reader = blob.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    file.push(value);
  }
  file.push(new Uint8Array(0), true);
}

/**
 * Writes the package into `sink`. `getAsset` reads the stored media; a file
 * that is gone throws before anything is written.
 */
export async function exportTimelineBundle(
  project: VideoProject,
  opts: { fps: number; getAsset: (id: string) => Promise<Pick<AssetRecord, "name" | "type" | "blob"> | undefined>; onProgress?: (message: string, fraction: number) => void },
  sink: BundleSink,
): Promise<BundleResult> {
  if (!project.clips.length) throw new Error("Add at least one clip before exporting.");
  const folder = safeFilename(project.name);
  const needed = timelineAssets(project);
  const records = new Map<string, Pick<AssetRecord, "name" | "type" | "blob">>();
  for (const a of needed) {
    const r = await opts.getAsset(a.id);
    if (!r) throw new Error(`“${a.name}” is missing from this browser's storage, so the timeline can't be packed. Remove it from the project and add the original file again.`);
    records.set(a.id, r);
  }

  const media: Record<string, NleMedia> = {};
  const taken = new Set<string>();
  needed.forEach((a, i) => {
    const r = records.get(a.id)!;
    const base = safeFilename(r.name.replace(/\.[^.]+$/, "") || a.name).slice(0, 60);
    let path = `media/${String(i + 1).padStart(2, "0")} ${base}.${mediaExtension(r, a.kind === "video" ? "mp4" : "wav")}`;
    while (taken.has(path.toLowerCase())) path = path.replace(/(\.[^.]+)$/, "_$1");
    taken.add(path.toLowerCase());
    media[a.id] = {
      path,
      duration: a.duration,
      hasVideo: a.kind === "video",
      hasAudio: a.kind === "audio" || (a.clip?.hasAudio ?? false),
      ...(a.kind === "video" && a.clip ? { width: a.clip.width, height: a.clip.height } : {}),
    };
  });

  const plan = planNle(project, { fps: opts.fps, media });
  const fcpxml = buildFcpxml(plan);
  const xmeml = buildXmeml(plan);
  const withCaptions = project.cues.length > 0;

  let pending: Promise<void> = Promise.resolve();
  let bytes = 0;
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    bytes += chunk.length;
    pending = pending.then(() => sink.write(chunk));
  });
  const text = (name: string, data: string) => {
    const f = new ZipDeflate(`${folder}/${name}`, { level: 6 });
    zip.add(f);
    f.push(strToU8(data), true);
  };
  text(`${folder}.fcpxml`, fcpxml);
  text(`${folder}.xml`, xmeml);
  if (withCaptions) text(`${folder}.srt`, toSrt(project.cues, project.captions.showTranslated));
  text("READ ME.txt", readMe(project.name, plan, withCaptions));

  const total = Object.keys(media).length;
  let n = 0;
  for (const a of needed) {
    opts.onProgress?.(`Packing ${media[a.id].path.split("/").pop()}`, n / total);
    const f = new ZipPassThrough(`${folder}/${media[a.id].path}`);
    zip.add(f);
    await pump(records.get(a.id)!.blob, f);
    await pending;
    n++;
  }
  zip.end();
  await pending;
  return { plan, files: total + 3 + (withCaptions ? 1 : 0), bytes };
}
