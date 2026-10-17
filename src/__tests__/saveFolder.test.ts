import { beforeEach, describe, expect, it, vi } from "vitest";

const downloadBlob = vi.fn();
vi.mock("@/lib/utils/download", () => ({ downloadBlob: (...args: unknown[]) => downloadBlob(...args) }));

import { saveDownload, type SaveFolder } from "@/lib/utils/saveFolder";

function notFound() {
  return new DOMException("missing", "NotFoundError");
}

/** An in-memory folder: remembers which names exist and what was written to them. */
function fakeFolder(existing: string[] = [], failWith?: DOMException): SaveFolder & { written: Map<string, Blob[]> } {
  const files = new Set(existing);
  const written = new Map<string, Blob[]>();
  return {
    name: "NoCap Edit",
    written,
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw notFound();
        files.add(name);
      }
      return {
        async createWritable() {
          if (failWith) throw failWith;
          return {
            async write(data: Blob) {
              written.set(name, [...(written.get(name) ?? []), data]);
            },
            async close() {},
            async abort() {},
          };
        },
      };
    },
  };
}

const file = new File(["video"], "Clip.mp4", { type: "video/mp4" });

describe("saveDownload", () => {
  beforeEach(() => downloadBlob.mockClear());

  it("writes into the chosen folder without a browser download", async () => {
    const folder = fakeFolder();
    expect(await saveDownload(file, folder)).toBe("NoCap Edit");
    expect(folder.written.get("Clip.mp4")).toHaveLength(1);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("never overwrites a file that is already there", async () => {
    const folder = fakeFolder(["Clip.mp4", "Clip (2).mp4"]);
    await saveDownload(file, folder);
    expect([...folder.written.keys()]).toEqual(["Clip (3).mp4"]);
  });

  it("falls back to a normal download when the folder refuses the write", async () => {
    const folder = fakeFolder([], new DOMException("no", "NotAllowedError"));
    expect(await saveDownload(file, folder)).toBeNull();
    expect(downloadBlob).toHaveBeenCalledWith(file, "Clip.mp4");
  });

  it("uses a normal download when no folder was chosen", async () => {
    expect(await saveDownload(file, null)).toBeNull();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });
});
