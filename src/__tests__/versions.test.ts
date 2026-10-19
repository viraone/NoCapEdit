import { describe, expect, it } from "vitest";
import { createClip, createProject, createTextOverlay, type VideoProject } from "@/lib/models/project";
import { assetsUsedByVersions, restoreProject, sameEdit, versionName, versionSummary } from "@/lib/storage/versions";

function base(): VideoProject {
  return createProject({
    name: "Reel",
    clips: [createClip({ assetId: "a", name: "A", duration: 8, width: 1920, height: 1080, hasAudio: true })],
  });
}

describe("versionName", () => {
  it("uses what was typed, tidied", () => {
    expect(versionName("  Before   the intro  ", [])).toBe("Before the intro");
  });
  it("numbers an empty name and skips numbers already taken", () => {
    expect(versionName("", [])).toBe("Version 1");
    expect(versionName("   ", [{ name: "Version 2" }, { name: "x" }])).toBe("Version 3");
  });
  it("cuts a very long name", () => {
    expect(versionName("x".repeat(200), []).length).toBe(60);
  });
});

describe("restoreProject", () => {
  it("brings back the content and keeps the project's own identity", () => {
    const saved = base();
    saved.overlays.push(createTextOverlay("title", 0, 2));
    const current: VideoProject = { ...base(), id: "prj_live", name: "Renamed", createdAt: 5, updatedAt: 99, sourceProjectId: "src" };
    current.clips[0].speed = 2;
    const next = restoreProject(current, saved);
    expect(next.id).toBe("prj_live");
    expect(next.name).toBe("Renamed");
    expect(next.createdAt).toBe(5);
    expect(next.sourceProjectId).toBe("src");
    expect(next.overlays).toHaveLength(1);
    expect(next.clips[0].speed).toBe(1);
  });

  it("copies, so editing the restored project cannot change the saved one", () => {
    const saved = base();
    const next = restoreProject(base(), saved);
    next.clips[0].speed = 3;
    expect(saved.clips[0].speed).toBe(1);
  });

  it("drops a link to a source video the live project does not have", () => {
    const saved = { ...base(), sourceProjectId: "old" };
    expect(restoreProject(base(), saved).sourceProjectId).toBeUndefined();
  });
});

describe("sameEdit", () => {
  it("ignores the save stamp and the name", () => {
    const a = base();
    const b = { ...structuredClone(a), updatedAt: a.updatedAt + 1000, name: "Other" };
    expect(sameEdit(a, b)).toBe(true);
  });
  it("sees a real change", () => {
    const a = base();
    const b = structuredClone(a);
    b.clips[0].outPoint = 4;
    expect(sameEdit(a, b)).toBe(false);
  });
});

describe("versionSummary and kept assets", () => {
  it("says what a version holds", () => {
    const p = base();
    p.cues.push({ id: "c", start: 0, end: 1, text: "hi" });
    expect(versionSummary(p)).toBe("1 clip · 0:08.0 · 1 caption");
  });

  it("keeps every file a version uses, including ones the live project dropped", () => {
    const old = base();
    old.music = { assetId: "song", name: "S", duration: 10, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: 0, loop: false };
    const used = assetsUsedByVersions([{ project: old }, { project: base() }]);
    expect([...used].sort()).toEqual(["a", "song"]);
  });
});
