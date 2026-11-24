import { describe, expect, it } from "vitest";
import { backupAllProjects, uniqueBackupNames, type BackupFolderLike } from "@/lib/storage/backupAll";

describe("uniqueBackupNames", () => {
  it("gives each name a .nocap suffix and keeps them distinct", () => {
    const names = uniqueBackupNames(["My Film", "Other"]);
    expect(names).toHaveLength(2);
    expect(names[0].endsWith(".nocap")).toBe(true);
    expect(names[1].endsWith(".nocap")).toBe(true);
    expect(names[0]).not.toBe(names[1]);
  });

  it("disambiguates case-insensitive clashes", () => {
    const names = uniqueBackupNames(["Trip", "Trip", "trip"]);
    expect(names).toHaveLength(3);
    const lower = names.map((n) => n.toLowerCase());
    expect(new Set(lower).size).toBe(3);
    expect(names[0]).toBe(uniqueBackupNames(["Trip"])[0]);
    expect(names[1].endsWith(" (2).nocap")).toBe(true);
  });

  it("handles an empty list", () => {
    expect(uniqueBackupNames([])).toEqual([]);
  });
});

describe("backupAllProjects", () => {
  it("writes one file per project sequentially", async () => {
    const getFileHandleNames: string[] = [];
    const writables: { chunks: Uint8Array[]; closed: number; aborted: number }[] = [];
    const folder: BackupFolderLike = {
      name: "backups",
      getFileHandle: async (name) => {
        getFileHandleNames.push(name);
        const w = { chunks: [] as Uint8Array[], closed: 0, aborted: 0 };
        writables.push(w);
        return {
          createWritable: async () => ({
            write: async (d) => { w.chunks.push(d); },
            close: async () => { w.closed++; },
            abort: async () => { w.aborted++; },
          }),
        };
      },
    };
    const projects = [{ id: "a", name: "One" }, { id: "b", name: "Two" }];
    const exportOne = async (_id: string, sink: { write: (c: Uint8Array) => Promise<void> | void }, onProgress?: (d: number, t: number) => void) => {
      await sink.write(new Uint8Array([1, 2, 3]));
      onProgress?.(1, 2);
    };
    const messages: string[] = [];
    const count = await backupAllProjects(projects, folder, (m) => messages.push(m), exportOne);
    expect(count).toBe(2);
    const expectedNames = uniqueBackupNames(projects.map((p) => p.name));
    expect(getFileHandleNames).toEqual(expectedNames);
    expect(writables).toHaveLength(2);
    for (const w of writables) {
      expect(w.closed).toBe(1);
      expect(w.aborted).toBe(0);
    }
    expect(messages.some((m) => m.startsWith("Backing up 1 of 2"))).toBe(true);
    expect(messages.some((m) => m.startsWith("Backing up 2 of 2"))).toBe(true);
  });

  it("aborts the writable and stops on failure", async () => {
    const getFileHandleNames: string[] = [];
    const writables: { closed: number; aborted: number }[] = [];
    const folder: BackupFolderLike = {
      name: "backups",
      getFileHandle: async (name) => {
        getFileHandleNames.push(name);
        const w = { closed: 0, aborted: 0 };
        writables.push(w);
        return {
          createWritable: async () => ({
            write: async () => {},
            close: async () => { w.closed++; },
            abort: async () => { w.aborted++; },
          }),
        };
      },
    };
    const projects = [{ id: "a", name: "One" }, { id: "b", name: "Two" }];
    const err = new Error("boom");
    const exportOne = async (): Promise<void> => {
      throw err;
    };
    await expect(backupAllProjects(projects, folder, undefined, exportOne)).rejects.toBe(err);
    expect(getFileHandleNames).toHaveLength(1);
    expect(writables[0].aborted).toBe(1);
    expect(writables[0].closed).toBe(0);
  });
});
