/**
 * Output sinks for streamed renders. The disk sink uses the File System
 * Access API so multi-gigabyte renders never live in memory; the Blob sink is
 * the fallback (browsers page large Blobs to disk themselves).
 */
export interface OutputSink {
  readonly kind: "disk" | "blob";
  readonly name: string;
  write(chunk: Uint8Array): Promise<void>;
  /** Finishes the file. Returns the Blob for in-memory sinks, null for disk. */
  close(): Promise<Blob | null>;
  abort(): Promise<void>;
  /** Discards everything written so far and starts over (used when a render restarts). */
  reset(): Promise<void>;
  bytes: number;
}

interface FileSystemWritableLike {
  write(data: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}
interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<FileSystemWritableLike>;
}
type SaveFilePicker = (opts: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandleLike>;

export function supportsDiskStreaming(): boolean {
  return typeof window !== "undefined" && "showSaveFilePicker" in window;
}

export function createBlobSink(name: string, type = "video/mp4"): OutputSink {
  const parts: Uint8Array[] = [];
  let bytes = 0;
  return {
    kind: "blob",
    name,
    get bytes() {
      return bytes;
    },
    set bytes(v: number) {
      bytes = v;
    },
    async write(chunk) {
      parts.push(chunk);
      bytes += chunk.byteLength;
    },
    async close() {
      return new Blob(parts as BlobPart[], { type });
    },
    async abort() {
      parts.length = 0;
    },
    async reset() {
      parts.length = 0;
      bytes = 0;
    },
  };
}

/**
 * Asks the user where to save the file. Must be called synchronously inside a
 * user gesture (e.g. the Export button's click handler). Returns null when the
 * API is unavailable or the dialog was dismissed.
 */
export async function requestDiskSink(suggestedName: string): Promise<OutputSink | null> {
  if (!supportsDiskStreaming()) return null;
  const picker = (window as unknown as { showSaveFilePicker: SaveFilePicker }).showSaveFilePicker;
  let handle: FileSystemFileHandleLike;
  try {
    handle = await picker({ suggestedName, types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }] });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
  let writable = await handle.createWritable();
  let bytes = 0;
  return {
    kind: "disk",
    name: handle.name,
    get bytes() {
      return bytes;
    },
    set bytes(v: number) {
      bytes = v;
    },
    async write(chunk) {
      await writable.write(chunk);
      bytes += chunk.byteLength;
    },
    async close() {
      await writable.close();
      return null;
    },
    async abort() {
      await writable.abort().catch(() => undefined);
    },
    async reset() {
      await writable.abort().catch(() => undefined);
      writable = await handle.createWritable();
      bytes = 0;
    },
  };
}
