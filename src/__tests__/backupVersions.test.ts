import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClip, createProject, type VideoProject } from "@/lib/models/project";

const store = vi.hoisted(() => ({
  project: null as VideoProject | null,
  versions: [] as { id: string; projectId: string; name: string; createdAt: number; project: VideoProject }[],
  assets: new Map<string, { id: string; projectId: string; name: string; type: string; size: number; blob: Blob; createdAt: number }>(),
  savedProject: null as VideoProject | null,
  putVersions: [] as { id: string; projectId: string; name: string; createdAt: number; project: VideoProject }[],
  putAssets: [] as { id: string; projectId: string }[],
}));

vi.mock("@/lib/storage/db", () => ({
  getProject: async () => store.project,
  listProjectAssets: async () => [...store.assets.values()],
  listVersions: async () => store.versions,
  putVersion: async (v: (typeof store.putVersions)[number]) => void store.putVersions.push(v),
  putAsset: async (a: { id: string; projectId: string }) => void store.putAssets.push(a),
  saveProject: async (p: VideoProject) => void (store.savedProject = p),
  getAsset: async (id: string) => (store.assets.has(id) ? store.assets.get(id) : undefined),
  putPeaks: async () => undefined,
  putThumbs: async () => undefined,
}));
vi.mock("@/lib/ffmpeg/waveform", () => ({ decodeAudio: async () => null, peaksFromSamples: () => ({ peaks: new Uint8Array(), perSecond: 50, duration: 0 }) }));
vi.mock("@/lib/media/thumbnails", () => ({ generateFilmstrip: async () => ({}) }));

import { exportBackup, importBackup } from "@/lib/storage/backup";

describe("backup with saved versions", () => {
  beforeEach(() => {
    store.putVersions.length = 0;
    store.putAssets.length = 0;
    store.savedProject = null;
  });

  it("round-trips the versions and points their media at the restored files", async () => {
    const clip = createClip({ assetId: "asset_a", name: "A", duration: 4, width: 640, height: 360, hasAudio: true });
    const live = createProject({ id: "prj_1", name: "Live", clips: [clip] });
    const old = { ...structuredClone(live), music: { assetId: "asset_song", name: "Song", duration: 9, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: 0, loop: false } };
    store.project = live;
    store.versions = [{ id: "ver_1", projectId: "prj_1", name: "Before the song was removed", createdAt: 1234, project: old }];
    for (const id of ["asset_a", "asset_song"]) {
      store.assets.set(id, { id, projectId: "prj_1", name: `${id}.bin`, type: "video/mp4", size: 3, blob: new Blob([new Uint8Array([1, 2, 3])]), createdAt: 1 });
    }

    const chunks: Uint8Array[] = [];
    await exportBackup("prj_1", { write: (c) => void chunks.push(c) });
    const file = new File([new Blob(chunks as BlobPart[])], "x.nocap");
    // Restoring onto a device that already has these asset ids gives them new ones.
    const newId = await importBackup(file);

    expect(newId).not.toBe("prj_1");
    expect(store.savedProject?.id).toBe(newId);
    expect(store.putVersions).toHaveLength(1);
    const v = store.putVersions[0];
    expect(v.projectId).toBe(newId);
    expect(v.name).toBe("Before the song was removed");
    expect(v.createdAt).toBe(1234);
    expect(v.project.id).toBe(newId);
    const restoredIds = new Set(store.putAssets.map((a) => a.id));
    expect(restoredIds.has(v.project.music!.assetId)).toBe(true);
    expect(restoredIds.has(v.project.clips[0].assetId)).toBe(true);
    expect(v.project.clips[0].assetId).toBe(store.savedProject!.clips[0].assetId);
  });

  it("restores a backup made before versions existed", async () => {
    store.versions = [];
    store.project = createProject({ id: "prj_2", clips: [createClip({ assetId: "asset_a", name: "A", duration: 4, width: 640, height: 360, hasAudio: true })] });
    const chunks: Uint8Array[] = [];
    await exportBackup("prj_2", { write: (c) => void chunks.push(c) });
    await importBackup(new File([new Blob(chunks as BlobPart[])], "y.nocap"));
    expect(store.putVersions).toHaveLength(0);
    expect(store.savedProject).toBeTruthy();
  });
});
