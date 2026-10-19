/**
 * Named versions: a copy of the whole project the visitor saves on purpose and
 * can go back to. A version is just a project snapshot, kept in IndexedDB beside
 * the projects; its media is never copied, because the files stay in the assets
 * store, so a version costs a few kilobytes. The rules here are plain functions.
 */
import { collectAssetIds, normalizeProject, type VideoProject } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { uid } from "@/lib/utils/id";
import { sameProject } from "@/lib/utils/same";
import { formatTime } from "@/lib/utils/time";
import { listVersions, putVersion, type VersionRecord } from "./db";

/** More than this and the list stops being something a person can look through. */
export const MAX_VERSIONS = 40;
export const MAX_NAME_LENGTH = 60;

/** The name a version gets: what was typed, trimmed, or "Version N" when nothing was. */
export function versionName(requested: string, existing: Pick<VersionRecord, "name">[]): string {
  const typed = requested.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
  if (typed) return typed;
  const taken = new Set(existing.map((v) => v.name));
  let n = existing.length + 1;
  while (taken.has(`Version ${n}`)) n++;
  return `Version ${n}`;
}

/**
 * The project with a saved version's content. The project keeps its own id,
 * name, creation time and, for a reel, the link to the video it was cut from: going back
 * changes what is in the project, not what it is.
 */
export function restoreProject(current: VideoProject, saved: VideoProject): VideoProject {
  const next: VideoProject = { ...normalizeProject(structuredClone(saved)), id: current.id, name: current.name, createdAt: current.createdAt, updatedAt: current.updatedAt };
  if (current.sourceProjectId) next.sourceProjectId = current.sourceProjectId;
  else delete next.sourceProjectId;
  if (current.reel !== undefined) next.reel = current.reel;
  else delete next.reel;
  return next;
}

/** Whether two projects hold the same edit: the save stamp and the name do not count. */
export function sameEdit(a: VideoProject, b: VideoProject): boolean {
  return sameProject({ ...a, updatedAt: 0, name: "" }, { ...b, updatedAt: 0, name: "" });
}

/** A line that says what a version holds: "3 clips · 0:42 · 12 captions · music". */
export function versionSummary(p: VideoProject): string {
  const parts = [`${p.clips.length} clip${p.clips.length === 1 ? "" : "s"}`, formatTime(projectDuration(p.clips))];
  if (p.cues.length) parts.push(`${p.cues.length} caption${p.cues.length === 1 ? "" : "s"}`);
  if (p.overlays.length) parts.push(`${p.overlays.length} text/sticker${p.overlays.length === 1 ? "" : "s"}`);
  if (p.music) parts.push("music");
  return parts.join(" · ");
}

/** Every asset a saved version still uses, so cleanup keeps those files. */
export function assetsUsedByVersions(versions: Pick<VersionRecord, "project">[]): Set<string> {
  const ids = new Set<string>();
  for (const v of versions) for (const id of collectAssetIds(v.project)) ids.add(id);
  return ids;
}

/** Saves a copy of the project under a name. Throws when the project already has the most versions it may. */
export async function saveVersion(project: VideoProject, requestedName: string, existing?: VersionRecord[]): Promise<VersionRecord> {
  const versions = existing ?? (await listVersions(project.id));
  if (versions.length >= MAX_VERSIONS) throw new Error(`A project keeps up to ${MAX_VERSIONS} saved versions. Delete an old one first.`);
  const record: VersionRecord = { id: uid("ver"), projectId: project.id, name: versionName(requestedName, versions), createdAt: Date.now(), project: structuredClone(project) };
  await putVersion(record);
  return record;
}
