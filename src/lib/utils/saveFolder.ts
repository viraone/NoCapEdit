import { openDB } from "idb";
import { downloadBlob } from "@/lib/utils/download";

/**
 * A folder the visitor picked once, so a finished download can be written straight into
 * it with no "where do you want to save this?" dialog, even when the browser is set to ask
 * for every file. Needs the File System Access API (desktop Chrome and Edge); everywhere
 * else, and whenever the folder can't be written to, the file goes out as a normal
 * browser download instead, so a save never fails because of this.
 */
export interface SaveFolder {
  readonly name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<{ createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void>; abort(): Promise<void> }> }>;
  queryPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission?(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
}

type DirectoryPicker = (options: { id?: string; mode?: "readwrite"; startIn?: string }) => Promise<SaveFolder>;

const DB_NAME = "nocap-prefs";
const STORE = "handles";
const KEY = "saveFolder";

export function supportsSaveFolder(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window && typeof indexedDB !== "undefined";
}

async function prefsDb() {
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE);
    },
  });
}

/** The remembered folder, or null when none was chosen or it can't be read back. */
export async function loadSaveFolder(): Promise<SaveFolder | null> {
  if (!supportsSaveFolder()) return null;
  try {
    const db = await prefsDb();
    return ((await db.get(STORE, KEY)) as SaveFolder | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Shows the browser's folder picker and remembers the answer. Call it straight from a
 * click. Resolves to null when the visitor closes the picker; throws a readable message
 * when the browser refuses the folder.
 */
export async function chooseSaveFolder(): Promise<SaveFolder | null> {
  if (!supportsSaveFolder()) return null;
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  let folder: SaveFolder;
  try {
    folder = await picker({ id: "nocap-save-folder", mode: "readwrite", startIn: "downloads" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    if (e instanceof DOMException && e.name === "SecurityError") {
      throw new Error("Your browser won't let a website use that folder. Make a new folder inside Downloads (for example NoCap Edit) and pick that one.");
    }
    throw e;
  }
  try {
    const db = await prefsDb();
    await db.put(STORE, folder, KEY);
  } catch {
    throw new Error("Your browser couldn't remember that folder, so downloads will go to your normal Downloads folder.");
  }
  return folder;
}

/** Stops using the remembered folder; downloads go back to the browser's own Downloads handling. */
export async function forgetSaveFolder(): Promise<void> {
  try {
    const db = await prefsDb();
    await db.delete(STORE, KEY);
  } catch {
    /* nothing stored */
  }
}

/**
 * The remembered folder, if it can be written to. With `ask` (only from inside a click)
 * the browser's one-line "allow this site to edit files in …?" question is shown when the
 * permission has lapsed; without it, a lapsed permission just means no folder.
 */
export async function openSaveFolder(ask: boolean): Promise<SaveFolder | null> {
  const folder = await loadSaveFolder();
  if (!folder) return null;
  try {
    let state = (await folder.queryPermission?.({ mode: "readwrite" })) ?? "prompt";
    if (state !== "granted" && ask) state = (await folder.requestPermission?.({ mode: "readwrite" })) ?? "denied";
    return state === "granted" ? folder : null;
  } catch {
    return null;
  }
}

/** `name.ext` becomes `name (2).ext`, `name (3).ext`… until nothing in the folder has that name. */
async function freeName(folder: SaveFolder, name: string): Promise<string> {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    try {
      await folder.getFileHandle(candidate);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") return candidate;
      throw e;
    }
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * Saves a finished file. Into `folder` when there is one and it accepts the write;
 * otherwise as a normal browser download. Returns the folder's name when the file went
 * there, or null when it went through the browser's own download.
 */
export async function saveDownload(file: File, folder: SaveFolder | null): Promise<string | null> {
  if (folder) {
    try {
      const handle = await folder.getFileHandle(await freeName(folder, file.name), { create: true });
      const writable = await handle.createWritable();
      try {
        await writable.write(file);
        await writable.close();
      } catch (e) {
        await writable.abort().catch(() => undefined);
        throw e;
      }
      return folder.name;
    } catch {
      /* folder gone, moved or no longer allowed: fall through to a normal download */
    }
  }
  downloadBlob(file, file.name);
  return null;
}
