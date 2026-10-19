import { describe, expect, it } from "vitest";
import { createClip, createProject, createTextOverlay, type VideoProject } from "@/lib/models/project";
import { GIF_MAX_SECONDS, TRANSPARENT_MAX_SECONDS, gifArgs, gifProblem, transparentArgs, transparentProblem } from "@/lib/export/altFormats";

const withClip = (seconds: number, extra: Partial<VideoProject> = {}): VideoProject =>
  createProject({ clips: [createClip({ assetId: "a", name: "A", duration: seconds, width: 1920, height: 1080, hasAudio: true })], ...extra });

describe("gifArgs", () => {
  it("makes a palette from the clip itself and loops forever", () => {
    const args = gifArgs("in.mp4", "out.gif", 15);
    const graph = args[args.indexOf("-filter_complex") + 1];
    expect(graph).toContain("fps=15");
    expect(graph).toContain("palettegen");
    expect(graph).toContain("paletteuse");
    expect(args[args.indexOf("-loop") + 1]).toBe("0");
    expect(args.at(-1)).toBe("out.gif");
  });
});

describe("transparentArgs", () => {
  it("encodes WebM as VP8 (the wasm VP9 encoder crashes) with an alpha plane and no alt-ref frames", () => {
    const args = transparentArgs("f%05d.png", "t.webm", { format: "webm", fps: 30 });
    expect(args).toContain("libvpx");
    expect(args).not.toContain("libvpx-vp9");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuva420p");
    expect(args[args.indexOf("-auto-alt-ref") + 1]).toBe("0");
    expect(args[args.indexOf("-framerate") + 1]).toBe("30");
  });
  it("encodes MOV as ProRes 4444 with alpha", () => {
    const args = transparentArgs("f%05d.png", "t.mov", { format: "mov", fps: 24 });
    expect(args).toContain("prores_ks");
    expect(args[args.indexOf("-profile:v") + 1]).toBe("4444");
    expect(args[args.indexOf("-pix_fmt") + 1]).toBe("yuva444p10le");
  });
});

describe("problems", () => {
  it("refuses a GIF that is too long and an empty project", () => {
    expect(gifProblem(withClip(GIF_MAX_SECONDS))).toBeNull();
    expect(gifProblem(withClip(GIF_MAX_SECONDS + 5))).toMatch(/enormous/);
    expect(gifProblem(createProject())).toBeTruthy();
  });
  it("needs captions or text for a transparent video", () => {
    const on = { includeCaptions: true, includeOverlays: true };
    expect(transparentProblem(withClip(5), on)).toMatch(/nothing to put/);
    expect(transparentProblem(withClip(5, { overlays: [createTextOverlay("title", 0, 2)] }), on)).toBeNull();
    expect(transparentProblem(withClip(5, { overlays: [createTextOverlay("title", 0, 2)] }), { includeCaptions: true, includeOverlays: false })).toMatch(/nothing to put/);
    expect(transparentProblem(withClip(TRANSPARENT_MAX_SECONDS + 1, { overlays: [createTextOverlay("title", 0, 2)] }), on)).toMatch(/limited/);
  });
});
