/**
 * IndexedDB driver. Everything the app persists (projects, source video/audio/
 * image blobs, waveform peaks, filmstrip thumbnails) lives here on the user's
 * device. There is no server.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { normalizeProject, remapAssetIds, type VideoProject } from "@/lib/models/project";

export interface AssetRecord {
  id: string;
  projectId: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: number;
}

export interface PeaksRecord {
  assetId: string;
  /** Peak per bucket, 0..255. */
  peaks: Uint8Array;
  perSecond: number;
  duration: number;
}

export interface ThumbsRecord {
  assetId: string;
  sprite: Blob;
  count: number;
  frameWidth: number;
  frameHeight: number;
  duration: number;
}

export interface ProjectThumbRecord {
  projectId: string;
  blob: Blob;
}

interface ReelFlowDB extends DBSchema {
  projects: { key: string; value: VideoProject; indexes: { "by-updated": number } };
  assets: { key: string; value: AssetRecord; indexes: { "by-project": string } };
  peaks: { key: string; value: PeaksRecord };
  thumbs: { key: string; value: ThumbsRecord };
  projectThumbs: { key: string; value: ProjectThumbRecord };
}

const DB_NAME = "reelflow";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ReelFlowDB>> | null = null;

/** The open connection once getDb() has resolved, so a save can start synchronously (e.g. during pagehide). */
let openDb: Awaited<ReturnType<typeof openDB<ReelFlowDB>>> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = openDB<ReelFlowDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const projects = db.createObjectStore("projects", { keyPath: "id" });
        projects.createIndex("by-updated", "updatedAt");
        const assets = db.createObjectStore("assets", { keyPath: "id" });
        assets.createIndex("by-project", "projectId");
        db.createObjectStore("peaks", { keyPath: "assetId" });
        db.createObjectStore("thumbs", { keyPath: "assetId" });
        db.createObjectStore("projectThumbs", { keyPath: "projectId" });
      },
    });
    dbPromise.then((db) => (openDb = db)).catch(() => undefined);
  }
  return dbPromise;
}

// ---------- projects ----------

export async function listProjects(): Promise<VideoProject[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex("projects", "by-updated");
  return all.reverse().map(normalizeProject);
}

export async function getProject(id: string): Promise<VideoProject | undefined> {
  const db = await getDb();
  const p = await db.get("projects", id);
  return p ? normalizeProject(p) : undefined;
}

export async function saveProject(project: VideoProject): Promise<void> {
  // With the connection already open, the put is issued before this function
  // yields, so it is queued even when the page is being torn down.
  const db = openDb ?? (await getDb());
  await db.put("projects", project);
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  const assets = await db.getAllKeysFromIndex("assets", "by-project", id);
  const tx = db.transaction(["projects", "assets", "peaks", "thumbs", "projectThumbs"], "readwrite");
  await Promise.all([
    tx.objectStore("projects").delete(id),
    tx.objectStore("projectThumbs").delete(id),
    ...assets.flatMap((a) => [
      tx.objectStore("assets").delete(a),
      tx.objectStore("peaks").delete(a),
      tx.objectStore("thumbs").delete(a),
    ]),
  ]);
  await tx.done;
}

/** Copies a project together with its assets under a new id. */
export async function duplicateProject(id: string, newId: string, name: string): Promise<VideoProject | undefined> {
  const db = await getDb();
  const project = await db.get("projects", id);
  if (!project) return undefined;
  const assets = await db.getAllFromIndex("assets", "by-project", id);
  const idMap = new Map<string, string>();
  for (const a of assets) idMap.set(a.id, `${a.id}_${newId.slice(-6)}`);
  const remap = (assetId: string) => idMap.get(assetId) ?? assetId;
  const copy: VideoProject = remapAssetIds(
    { ...structuredClone(project), id: newId, name, createdAt: Date.now(), updatedAt: Date.now() },
    remap,
  );

  const tx = db.transaction(["projects", "assets", "peaks", "thumbs", "projectThumbs"], "readwrite");
  await tx.objectStore("projects").put(copy);
  for (const a of assets) {
    const nid = remap(a.id);
    await tx.objectStore("assets").put({ ...a, id: nid, projectId: newId });
    const peaks = await tx.objectStore("peaks").get(a.id);
    if (peaks) await tx.objectStore("peaks").put({ ...peaks, assetId: nid });
    const thumbs = await tx.objectStore("thumbs").get(a.id);
    if (thumbs) await tx.objectStore("thumbs").put({ ...thumbs, assetId: nid });
  }
  const thumb = await tx.objectStore("projectThumbs").get(id);
  if (thumb) await tx.objectStore("projectThumbs").put({ projectId: newId, blob: thumb.blob });
  await tx.done;
  return normalizeProject(copy);
}

// ---------- assets ----------

export async function putAsset(record: AssetRecord): Promise<void> {
  const db = await getDb();
  await db.put("assets", record);
}

export async function getAsset(id: string): Promise<AssetRecord | undefined> {
  const db = await getDb();
  return db.get("assets", id);
}

export async function listProjectAssets(projectId: string): Promise<AssetRecord[]> {
  const db = await getDb();
  return db.getAllFromIndex("assets", "by-project", projectId);
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(["assets", "peaks", "thumbs"], "readwrite");
  await Promise.all([
    tx.objectStore("assets").delete(id),
    tx.objectStore("peaks").delete(id),
    tx.objectStore("thumbs").delete(id),
  ]);
  await tx.done;
}

// ---------- caches ----------

export async function getPeaks(assetId: string) {
  return (await getDb()).get("peaks", assetId);
}
export async function putPeaks(record: PeaksRecord) {
  await (await getDb()).put("peaks", record);
}
export async function getThumbs(assetId: string) {
  return (await getDb()).get("thumbs", assetId);
}
export async function putThumbs(record: ThumbsRecord) {
  await (await getDb()).put("thumbs", record);
}
export async function getProjectThumb(projectId: string) {
  return (await getDb()).get("projectThumbs", projectId);
}
export async function putProjectThumb(projectId: string, blob: Blob) {
  await (await getDb()).put("projectThumbs", { projectId, blob });
}

// ---------- storage info ----------

export async function storageEstimate(): Promise<{ usage: number; quota: number; persisted: boolean }> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) {
    return { usage: 0, quota: 0, persisted: false };
  }
  const est = await navigator.storage.estimate();
  let persisted = false;
  try {
    persisted = (await navigator.storage.persisted?.()) ?? false;
  } catch {
    persisted = false;
  }
  return { usage: est.usage ?? 0, quota: est.quota ?? 0, persisted };
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
