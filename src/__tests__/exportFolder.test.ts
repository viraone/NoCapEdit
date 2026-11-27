import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadBlob = vi.fn();
vi.mock("@/lib/utils/download", () => ({ downloadBlob: (...args: unknown[]) => downloadBlob(...args) }));

import { createFolderSink, exportFolderBridge, folderError, saveExportFile, useExportFolder, type ExportFolderBridge, type ExportFolderInfo } from "@/lib/utils/exportFolder";

const FOLDER: ExportFolderInfo = { path: "/Users/me/Movies/Exports", name: "Exports", ok: true };

/** A fake shell that records every call by name and id, like the real bridge. */
function fakeBridge(options: { folder?: ExportFolderInfo | null; failWrite?: boolean } = {}) {
  const folder = options.folder === undefined ? FOLDER : options.folder;
  const calls: string[] = [];
  const files = new Map<string, Uint8Array[]>();
  let nextId = 1;
  const bridge: ExportFolderBridge = {
    info: async () => folder,
    choose: async () => folder,
    clear: async () => {
      calls.push("clear");
    },
    open: async (name) => {
      calls.push(`open:${name}`);
      const id = `id${nextId++}`;
      files.set(id, []);
      return id;
    },
    write: async (id, bytes) => {
      calls.push(`write:${id}`);
      if (options.failWrite) throw new Error("Error invoking remote method 'exportFolder:write': Error: the disk is full");
      files.get(id)!.push(bytes);
    },
    reset: async (id) => {
      calls.push(`reset:${id}`);
      files.get(id)!.length = 0;
    },
    close: async (id) => {
      calls.push(`close:${id}`);
      return { name: "Reel (2).mp4", folder: "Exports" };
    },
    read: async (id) => {
      calls.push(`read:${id}`);
      const parts = files.get(id) ?? [];
      const all = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let at = 0;
      for (const part of parts) {
        all.set(part, at);
        at += part.byteLength;
      }
      return all;
    },
    abort: async (id) => {
      calls.push(`abort:${id}`);
    },
    reveal: async (id) => {
      calls.push(`reveal:${id}`);
    },
  };
  return { bridge, calls };
}

describe("createFolderSink", () => {
  it("writes through the bridge, tracks bytes and remembers the saved file", async () => {
    const { bridge, calls } = fakeBridge();
    const sink = await createFolderSink(bridge, "Reel.mp4");
    expect(sink.kind).toBe("disk");
    expect(sink.name).toBe("Reel.mp4");
    expect(calls).toEqual(["open:Reel.mp4"]);

    await sink.write(new Uint8Array([1, 2, 3]));
    await sink.write(new Uint8Array([4, 5]));
    expect(sink.bytes).toBe(5);
    expect(calls).toEqual(["open:Reel.mp4", "write:id1", "write:id1"]);
    expect(sink.saved()).toBeNull();

    expect(await sink.close()).toBeNull();
    expect(sink.saved()).toEqual({ id: "id1", name: "Reel (2).mp4", folder: "Exports" });

    const file = await sink.file();
    expect(file.type).toBe("video/mp4");
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([1, 2, 3, 4, 5]);
    expect(calls).toContain("read:id1");
  });

  it("starts the file over with reset", async () => {
    const { bridge, calls } = fakeBridge();
    const sink = await createFolderSink(bridge, "Reel.mp4");
    await sink.write(new Uint8Array([1, 2]));
    await sink.reset();
    expect(sink.bytes).toBe(0);
    expect(calls).toEqual(["open:Reel.mp4", "write:id1", "reset:id1"]);
  });

  it("aborts an unfinished file but leaves a finished one alone", async () => {
    const { bridge, calls } = fakeBridge();
    const unfinished = await createFolderSink(bridge, "Reel.mp4");
    await unfinished.write(new Uint8Array([1]));
    await unfinished.abort();
    expect(calls).toContain("abort:id1");

    const finished = await createFolderSink(bridge, "Reel.mp4");
    await finished.close();
    const before = calls.length;
    await finished.abort();
    expect(calls.length).toBe(before);
  });

  it("swallows an abort error", async () => {
    const { bridge } = fakeBridge();
    bridge.abort = async () => {
      throw new Error("no such file");
    };
    const sink = await createFolderSink(bridge, "Reel.mp4");
    await expect(sink.abort()).resolves.toBeUndefined();
  });

  it("throws when the folder refuses the file", async () => {
    const { bridge } = fakeBridge();
    bridge.open = async () => {
      throw new Error("Error invoking remote method 'exportFolder:open': Error: no folder");
    };
    await expect(createFolderSink(bridge, "Reel.mp4")).rejects.toThrow("no folder");
  });
});

describe("saveExportFile", () => {
  beforeEach(() => downloadBlob.mockClear());

  it("saves into the folder and returns the name it got", async () => {
    const { bridge, calls } = fakeBridge();
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
    expect(await saveExportFile(blob, "Reel.mp4", bridge)).toEqual({ id: "id1", name: "Reel (2).mp4", folder: "Exports" });
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(calls).toEqual(["open:Reel.mp4", "write:id1", "close:id1"]);
  });

  it("sends the blob in 8 MB pieces", async () => {
    const { bridge, calls } = fakeBridge();
    const blob = new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]);
    await saveExportFile(blob, "Big.mp4", bridge);
    expect(calls.filter((call) => call === "write:id1")).toHaveLength(2);
    expect(calls).toContain("close:id1");
  });

  it("downloads when no folder is chosen", async () => {
    const { bridge, calls } = fakeBridge({ folder: null });
    const blob = new Blob(["sidecar"], { type: "text/plain" });
    expect(await saveExportFile(blob, "Reel.srt", bridge)).toBeNull();
    expect(downloadBlob).toHaveBeenCalledWith(blob, "Reel.srt");
    expect(calls).toEqual([]);
  });

  it("downloads when there is no bridge", async () => {
    const blob = new Blob(["sidecar"], { type: "text/plain" });
    expect(await saveExportFile(blob, "Reel.txt", null)).toBeNull();
    expect(downloadBlob).toHaveBeenCalledWith(blob, "Reel.txt");
  });

  it("downloads and aborts the half-written file when a write fails", async () => {
    const { bridge, calls } = fakeBridge({ failWrite: true });
    const blob = new Blob(["video"]);
    expect(await saveExportFile(blob, "Reel.mp4", bridge)).toBeNull();
    expect(downloadBlob).toHaveBeenCalledWith(blob, "Reel.mp4");
    expect(calls).toEqual(["open:Reel.mp4", "write:id1", "abort:id1"]);
  });

  it("downloads when info() itself fails", async () => {
    const { bridge, calls } = fakeBridge();
    bridge.info = async () => {
      throw new Error("the shell is gone");
    };
    const blob = new Blob(["video"]);
    expect(await saveExportFile(blob, "Reel.mp4", bridge)).toBeNull();
    expect(downloadBlob).toHaveBeenCalledWith(blob, "Reel.mp4");
    expect(calls).toEqual([]);
  });
});

describe("folderError", () => {
  it("removes Electron's wrapper", () => {
    expect(folderError(new Error("Error invoking remote method 'exportFolder:open': Error: Could not save into the folder \"Movies\": the disk is full."))).toBe('Could not save into the folder "Movies": the disk is full.');
    expect(folderError(new Error("Error invoking remote method 'exportFolder:write': the file is gone"))).toBe("the file is gone");
  });

  it("keeps a plain message", () => {
    expect(folderError(new Error("The folder is not there."))).toBe("The folder is not there.");
  });

  it("falls back for anything else", () => {
    expect(folderError("no")).toBe("Could not save into that folder.");
    expect(folderError(null)).toBe("Could not save into that folder.");
    expect(folderError(new Error(""))).toBe("Could not save into that folder.");
  });
});

describe("useExportFolder", () => {
  beforeEach(() => useExportFolder.setState({ folder: null }));

  it("has no bridge on the website", () => {
    expect(exportFolderBridge()).toBeNull();
  });

  it("does nothing without a bridge", async () => {
    await useExportFolder.getState().load();
    expect(useExportFolder.getState().folder).toBeNull();
    await useExportFolder.getState().choose();
    expect(useExportFolder.getState().folder).toBeNull();
    await useExportFolder.getState().clear();
    expect(useExportFolder.getState().folder).toBeNull();
  });
});
