import { exportBackup } from "./backup";
import { safeFilename } from "@/lib/utils/download";

/** The parts of the File System Access API this file uses. */
export interface BackupWritableLike { write(data: Uint8Array): Promise<void>; close(): Promise<void>; abort(): Promise<void>; }
export interface BackupFileHandleLike { createWritable(): Promise<BackupWritableLike>; }
export interface BackupFolderLike { name: string; getFileHandle(name: string, opts: { create: boolean }): Promise<BackupFileHandleLike>; }

/** One "<safe name>.nocap" per input name, in the same order, never two the same (compared case-insensitively). */
export function uniqueBackupNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    let base = safeFilename(name);
    if (!base) base = "project";
    let candidate = `${base}.nocap`;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} (${n}).nocap`;
      n++;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

export function supportsBackupFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

/** Asks for a folder to write into. Null when unsupported or the dialog was dismissed (DOMException name "AbortError"); other errors are thrown. Call it directly from a click handler. */
export async function pickBackupFolder(): Promise<BackupFolderLike | null> {
  if (!supportsBackupFolder()) return null;
  try {
    return await (window as unknown as { showDirectoryPicker: (opts: { mode: "readwrite"; id: string }) => Promise<BackupFolderLike> }).showDirectoryPicker({ mode: "readwrite", id: "nocap-backups" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** Writes one .nocap file per project into the folder, one after another. Returns how many were written. */
export async function backupAllProjects(
  projects: { id: string; name: string }[],
  folder: BackupFolderLike,
  onProgress?: (message: string) => void,
  exportOne: typeof exportBackup = exportBackup,
): Promise<number> {
  const names = uniqueBackupNames(projects.map((p) => p.name));
  for (let i = 0; i < projects.length; i++) {
    onProgress?.(`Backing up ${i + 1} of ${projects.length} · ${projects[i].name}`);
    const handle = await folder.getFileHandle(names[i], { create: true });
    const writable = await handle.createWritable();
    try {
      await exportOne(projects[i].id, { write: (chunk) => writable.write(chunk) }, (done, total) => onProgress?.(`Backing up ${i + 1} of ${projects.length} · ${projects[i].name} · ${total > 0 ? Math.round((done / total) * 100) : 0}%`));
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => {});
      throw e;
    }
  }
  return projects.length;
}
