/**
 * Saving exports straight into a folder the user picked (desktop app only).
 * On the website `window.nocapDesktop` does not exist and files download as before.
 */
import { create } from "zustand";
import type { OutputSink } from "@/lib/ffmpeg/sinks";
import { downloadBlob } from "@/lib/utils/download";

export interface ExportFolderInfo {
  /** The full path of the folder. */
  path: string;
  /** The folder's short name. */
  name: string;
  /** False when the folder has gone (moved, deleted, or the drive is not plugged in). */
  ok: boolean;
}

/** What desktop/preload.cjs exposes as `window.nocapDesktop.exportFolder`. */
export interface ExportFolderBridge {
  info(): Promise<ExportFolderInfo | null>;
  choose(): Promise<ExportFolderInfo | null>;
  clear(): Promise<void>;
  open(name: string): Promise<string>;
  write(id: string, bytes: Uint8Array): Promise<void>;
  reset(id: string): Promise<void>;
  close(id: string): Promise<{ name: string; folder: string }>;
  read(id: string): Promise<Uint8Array>;
  abort(id: string): Promise<void>;
  reveal(id: string): Promise<void>;
}

/** A file saved into the folder. The name may have a number in it, so nothing is overwritten. */
export interface SavedExport {
  id: string;
  name: string;
  folder: string;
}

/** A sink that writes into the chosen folder instead of memory or the save window. */
export interface FolderSink extends OutputSink {
  /** The finished file, or null until close() has finished. */
  saved(): SavedExport | null;
  file(): Promise<Blob>;
}

/** The folder bridge, or null on the website. */
export function exportFolderBridge(): ExportFolderBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { nocapDesktop?: { exportFolder?: ExportFolderBridge } }).nocapDesktop?.exportFolder ?? null;
}

/** The shell's error message without Electron's wrapper. */
export function folderError(e: unknown): string {
  const message = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "").trim() : "";
  return message || "Could not save into that folder.";
}

/** Opens a new file in the chosen folder. Throws when the folder cannot be written to. */
export async function createFolderSink(bridge: ExportFolderBridge, name: string, type = "video/mp4"): Promise<FolderSink> {
  const id = await bridge.open(name);
  let bytes = 0;
  let saved: SavedExport | null = null;
  let closed = false;
  return {
    kind: "disk",
    name,
    get bytes() {
      return bytes;
    },
    set bytes(v: number) {
      bytes = v;
    },
    async write(chunk) {
      await bridge.write(id, chunk);
      bytes += chunk.byteLength;
    },
    async close() {
      const done = await bridge.close(id);
      closed = true;
      saved = { id, name: done.name, folder: done.folder };
      return null;
    },
    async abort() {
      // A finished file is the user's and stays.
      if (closed) return;
      await bridge.abort(id).catch(() => undefined);
    },
    async reset() {
      await bridge.reset(id);
      bytes = 0;
    },
    async file() {
      const data = await bridge.read(id);
      return new Blob([data as BlobPart], { type });
    },
    saved: () => saved,
  };
}

/** Bytes sent to the shell per message when saving a finished file. */
const PIECE_BYTES = 8 * 1024 * 1024;

/**
 * Saves a finished file into the chosen folder. Falls back to a browser download when there is no
 * folder, or when anything about the folder fails, so a save is never lost.
 */
export async function saveExportFile(blob: Blob, name: string, bridge: ExportFolderBridge | null = exportFolderBridge()): Promise<SavedExport | null> {
  if (!bridge) {
    downloadBlob(blob, name);
    return null;
  }
  let sink: FolderSink | null = null;
  try {
    const folder = await bridge.info();
    if (!folder) {
      downloadBlob(blob, name);
      return null;
    }
    sink = await createFolderSink(bridge, name, blob.type || "video/mp4");
    for (let offset = 0; offset < blob.size; offset += PIECE_BYTES) {
      await sink.write(new Uint8Array(await blob.slice(offset, offset + PIECE_BYTES).arrayBuffer()));
    }
    await sink.close();
    return sink.saved();
  } catch {
    if (sink) await sink.abort();
    downloadBlob(blob, name);
    return null;
  }
}

interface ExportFolderState {
  /** The folder exports save into, or null for a save window each time. */
  folder: ExportFolderInfo | null;
  /** Reads the remembered folder from the shell. */
  load(): Promise<void>;
  /** Picks a folder; keeps the old one when the picker is closed. */
  choose(): Promise<void>;
  /** Goes back to a save window each time. */
  clear(): Promise<void>;
}

export const useExportFolder = create<ExportFolderState>((set) => ({
  folder: null,
  async load() {
    const bridge = exportFolderBridge();
    if (!bridge) return;
    try {
      set({ folder: await bridge.info() });
    } catch {
      set({ folder: null });
    }
  },
  async choose() {
    const bridge = exportFolderBridge();
    if (!bridge) return;
    try {
      const folder = await bridge.choose();
      if (folder) set({ folder });
    } catch {
      // The old choice stands.
    }
  },
  async clear() {
    const bridge = exportFolderBridge();
    if (!bridge) return;
    try {
      await bridge.clear();
    } catch {
      // Forget it here anyway.
    }
    set({ folder: null });
  },
}));
