import { describe, expect, it } from "vitest";
import { createClip, createProject, type ProjectDocumentary } from "@/lib/models/project";
import type { DocScript } from "@/lib/documentary/script";
import type { FilmTimeline } from "@/lib/documentary/timeline";
import { applyRevoice, filmHeightFor, filmStyle } from "@/lib/documentary/revoice";

const script: DocScript = {
  title: "A saved film",
  scenes: [{ id: "s1", kind: "point", heading: "One idea", lines: [], narration: "The narrator says this." }],
};

const animatedScript: DocScript = {
  title: "An animated film",
  scenes: [
    { id: "s1", kind: "point", heading: "One idea", lines: [], narration: "The narrator says this.", visual: { type: "icons", icons: [] } },
  ],
};

const timeline: FilmTimeline = { scenes: [], total: 42 };

function documentary(extra: Partial<ProjectDocumentary> = {}): ProjectDocumentary {
  return { assetId: "film", script, timeline, transcript: "the original transcript", ...extra };
}

function clip(assetId: string, extra: Partial<ReturnType<typeof createClip>> = {}) {
  return { ...createClip({ assetId, name: `${assetId}.mp4`, duration: 10, width: 1920, height: 1080, hasAudio: true }), ...extra };
}

describe("filmStyle", () => {
  it("uses the style saved on the project", () => {
    expect(filmStyle(documentary({ style: "documentary", script: animatedScript }))).toBe("documentary");
    expect(filmStyle(documentary({ style: "animation" }))).toBe("animation");
  });

  it("reads a scene visual as animation when no style was saved", () => {
    expect(filmStyle(documentary({ script: animatedScript }))).toBe("animation");
  });

  it("reads a script with no visuals as documentary when no style was saved", () => {
    expect(filmStyle(documentary())).toBe("documentary");
  });
});

describe("filmHeightFor", () => {
  it("keeps a 720p film at 720", () => {
    expect(filmHeightFor(720)).toBe(720);
  });

  it("renders a 1080p film at 1080", () => {
    expect(filmHeightFor(1080)).toBe(1080);
  });

  it("never goes above 1080", () => {
    expect(filmHeightFor(1920)).toBe(1080);
  });
});

describe("applyRevoice", () => {
  it("replaces the film clip and carries its background and look over", () => {
    const project = createProject({ clips: [clip("film")], documentary: documentary() });
    project.clips[0].background = "#123456";
    project.clips[0].look = { lutAssetId: "lut", lutName: "Warm", brightness: 0.1, contrast: 1.1, saturation: 1.2 };
    const next = clip("new-film");

    applyRevoice(project, { clip: next, timeline, voice: "kokoro:af_bella", style: "animation" });

    expect(project.clips).toHaveLength(1);
    expect(project.clips[0].id).toBe(next.id);
    expect(project.clips[0].assetId).toBe("new-film");
    expect(project.clips[0].background).toBe("#123456");
    expect(project.clips[0].look).toEqual({ lutAssetId: "lut", lutName: "Warm", brightness: 0.1, contrast: 1.1, saturation: 1.2 });
    expect(project.documentary).toEqual({
      assetId: "new-film",
      script,
      timeline,
      transcript: "the original transcript",
      voice: "kokoro:af_bella",
      style: "animation",
    });
    expect(project.documentary?.script).toBe(script);
  });

  it("puts one new clip at the first film position when the film was cut into two", () => {
    const keep = clip("other");
    const project = createProject({ clips: [clip("film"), keep, clip("film")], documentary: documentary() });
    const next = clip("new-film");

    applyRevoice(project, { clip: next, timeline, voice: "kokoro:am_michael", style: "documentary" });

    expect(project.clips).toHaveLength(2);
    expect(project.clips[0].id).toBe(next.id);
    expect(project.clips[1]).toBe(keep);
  });

  it("does nothing when the project is not a documentary", () => {
    const project = createProject({ clips: [clip("film")] });
    const before = structuredClone(project);

    applyRevoice(project, { clip: clip("new-film"), timeline, voice: "kokoro:af_heart", style: "documentary" });

    expect(project).toEqual(before);
  });

  it("puts the new film at the start when no clip uses the old asset", () => {
    const keep = clip("other");
    const project = createProject({ clips: [keep], documentary: documentary() });
    const next = clip("new-film");

    applyRevoice(project, { clip: next, timeline, voice: "kokoro:af_heart", style: "documentary" });

    expect(project.clips).toHaveLength(2);
    expect(project.clips[0]).toBe(next);
    expect(project.clips[1]).toBe(keep);
    expect(project.documentary?.assetId).toBe("new-film");
  });
});
