/**
 * .nocap project bundles: a zip (stored, not compressed, since media is already
 * compressed) holding manifest.json, project.json and every asset Blob.
 * Streams in both directions so multi-GB projects never sit in memory twice.
 */
import { Zip, ZipPassThrough, ZipDeflate, Unzip, UnzipInflate, UnzipPassThrough, strToU8, strFromU8 } from "fflate";
import { normalizeProject, type VideoProject } from "@/lib/models/project";
import { getProject, listProjectAssets, putAsset, saveProject, getAsset, putPeaks, putThumbs } from "./db";
import { uid } from "@/lib/utils/id";
import { decodeAudio, peaksFromSamples } from "@/lib/ffmpeg/waveform";
import { generateFilmstrip } from "@/lib/media/thumbnails";

export const BACKUP_VERSION = 1;

interface Manifest {
  version: number;
  app: string;
  exportedAt: number;
  assets: { id: string; name: string; type: string; size: number; file: string }[];
}

export interface BackupSink {
  write(chunk: Uint8Array): Promise<void> | void;
}

async function pump(blob: Blob, file: ZipPassThrough | ZipDeflate) {
  const reader = blob.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    file.push(value);
  }
  file.push(new Uint8Array(0), true);
}

/** Streams a project and its media into `sink` as a .nocap zip. */
export async function exportBackup(projectId: string, sink: BackupSink, onProgress?: (done: number, total: number) => void): Promise<void> {
  const project = await getProject(projectId);
  if (!project) throw new Error("Project not found.");
  const assets = await listProjectAssets(projectId);
  let pending = Promise.resolve();
  const zip = new Zip((err, chunk) => {
    if (err) throw err;
    pending = pending.then(() => sink.write(chunk));
  });
  const manifest: Manifest = { version: BACKUP_VERSION, app: "NoCap Edit", exportedAt: Date.now(), assets: assets.map((a) => ({ id: a.id, name: a.name, type: a.type, size: a.size, file: `assets/${a.id}` })) };
  const text = (name: string, data: string) => {
    const f = new ZipDeflate(name, { level: 6 });
    zip.add(f);
    f.push(strToU8(data), true);
  };
  text("manifest.json", JSON.stringify(manifest, null, 2));
  text("project.json", JSON.stringify(project));
  const total = assets.reduce((s, a) => s + a.size, 0) || 1;
  let done = 0;
  for (const a of assets) {
    const f = new ZipPassThrough(`assets/${a.id}`);
    zip.add(f);
    await pump(a.blob, f);
    done += a.size;
    onProgress?.(done, total);
    await pending;
  }
  zip.end();
  await pending;
}

/** Restores a .nocap bundle as a new project; returns its id. */
export async function importBackup(file: File, onProgress?: (message: string) => void): Promise<string> {
  const newId = uid("prj");
  let manifest: Manifest | null = null;
  let projectJson = "";
  const assetParts = new Map<string, Uint8Array[]>();
  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  unzip.register(UnzipPassThrough);
  unzip.onfile = (entry) => {
    const chunks: Uint8Array[] = [];
    entry.ondata = (err, data, final) => {
      if (err) throw err;
      chunks.push(data);
      if (!final) return;
      if (entry.name === "manifest.json") manifest = JSON.parse(strFromU8(concat(chunks)));
      else if (entry.name === "project.json") projectJson = strFromU8(concat(chunks));
      else if (entry.name.startsWith("assets/")) assetParts.set(entry.name.slice(7), chunks);
    };
    entry.start();
  };
  onProgress?.("Reading bundle");
  const reader = file.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    unzip.push(value, false);
  }
  unzip.push(new Uint8Array(0), true);
  if (!manifest || !projectJson) throw new Error("This is not a NoCap Edit backup.");
  const m = manifest as Manifest;
  if (m.version > BACKUP_VERSION) throw new Error("This backup was made by a newer version of NoCap Edit.");

  const raw = JSON.parse(projectJson) as VideoProject;
  const project = normalizeProject({ ...raw, id: newId, name: raw.name, updatedAt: Date.now() });
  // Remap asset ids that already exist on this device.
  const idMap = new Map<string, string>();
  for (const a of m.assets) idMap.set(a.id, (await getAsset(a.id)) ? uid("asset") : a.id);
  const remap = (id: string) => idMap.get(id) ?? id;
  project.clips = project.clips.map((c) => ({ ...c, assetId: remap(c.assetId), audioAssetId: c.audioAssetId ? remap(c.audioAssetId) : c.audioAssetId }));
  project.overlays = project.overlays.map((o) => (o.kind === "image" ? { ...o, assetId: remap(o.assetId) } : o));
  project.voiceovers = project.voiceovers.map((v) => ({ ...v, assetId: remap(v.assetId) }));
  if (project.music) project.music = { ...project.music, assetId: remap(project.music.assetId) };

  const videoAssets: { id: string; blob: Blob }[] = [];
  for (const a of m.assets) {
    const parts = assetParts.get(a.id);
    if (!parts) continue;
    const blob = new Blob(parts as BlobPart[], { type: a.type });
    const id = remap(a.id);
    onProgress?.(`Restoring ${a.name}`);
    await putAsset({ id, projectId: newId, name: a.name, type: a.type, size: blob.size, blob, createdAt: Date.now() });
    if (a.type.startsWith("video/")) videoAssets.push({ id, blob });
  }
  await saveProject(project);

  // Rebuild caches (waveform peaks and filmstrips) in the background.
  void (async () => {
    for (const { id, blob } of videoAssets) {
      const clip = project.clips.find((c) => c.assetId === id);
      try {
        const decoded = await decodeAudio(blob);
        if (decoded) {
          const peaks = peaksFromSamples(decoded.samples, decoded.sampleRate, 50);
          await putPeaks({ assetId: id, peaks: peaks.peaks, perSecond: peaks.perSecond, duration: peaks.duration });
        }
        if (clip) await putThumbs(await generateFilmstrip(id, blob, clip.duration));
      } catch {
        /* caches are optional */
      }
    }
  })();
  return newId;
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
