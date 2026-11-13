import { describe, expect, it } from "vitest";
import { needsCompositor } from "@/lib/playback/compositor";
import {
  createClip,
  createLottieOverlay,
  createProject,
  createTextOverlay,
  defaultSubtitleStyle,
  type Clip,
  type VideoProject,
} from "@/lib/models/project";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    ...createClip({ assetId: "asset-1", name: "clip.mp4", duration: 10, width: 1920, height: 1080, hasAudio: false }),
    ...over,
  };
}

function project(over: Partial<VideoProject> = {}): VideoProject {
  return createProject({ clips: [clip()], ...over });
}

describe("needsCompositor", () => {
  it("leaves plain cuts to the native pipeline", () => {
    expect(needsCompositor(createProject(), 0, 5)).toBe(false);
    expect(needsCompositor(project(), 0, 10)).toBe(false);
    expect(needsCompositor(project({ clips: [clip({ inPoint: 0, outPoint: 2 })] }), 5, 10)).toBe(false);
  });

  it("detects a GPU transition only where it overlaps the segment", () => {
    const gpu = project({
      clips: [clip({ transition: { type: "glsl:glitch", duration: 0.5 } }), clip({ assetId: "asset-2" })],
    });
    // The first clip is 0..10 and its GLSL transition runs from 9.5 to 10.
    expect(needsCompositor(gpu, 9.6, 10.4)).toBe(true);
    expect(needsCompositor(gpu, 0, 9.4)).toBe(false);
    // An empty window that only touches the transition edge needs nothing.
    expect(needsCompositor(gpu, 9.5, 9.5)).toBe(false);

    // xfade can render a native transition without compositing.
    const native = project({
      clips: [clip({ transition: { type: "fade", duration: 0.5 } }), clip({ assetId: "asset-2" })],
    });
    expect(needsCompositor(native, 9.6, 10.4)).toBe(false);
  });

  it("detects a reframe or matte on a clip inside the segment", () => {
    const reframed = project({ clips: [clip({ reframe: { keyframes: [{ t: 0, x: 0.5, y: 0.5 }] } })] });
    expect(needsCompositor(reframed, 2, 4)).toBe(true);
    expect(needsCompositor(reframed, 10, 12)).toBe(false);
    expect(needsCompositor(project({ clips: [clip({ reframe: null })] }), 2, 4)).toBe(false);

    const matted = project({
      clips: [
        clip({
          matte: { assetId: "matte-1", width: 1920, height: 1080, fps: 30, count: 10, inPoint: 0, outPoint: 10 },
        }),
      ],
    });
    expect(needsCompositor(matted, 2, 4)).toBe(true);
    expect(needsCompositor(matted, 10, 12)).toBe(false);
  });

  it("detects overlays the native path cannot express", () => {
    const plain = project({ overlays: [createTextOverlay("title", 1, 4)] });
    expect(needsCompositor(plain, 0, 5)).toBe(false);
    expect(needsCompositor(plain, 5, 8)).toBe(false);

    const animated = project({ overlays: [{ ...createTextOverlay("title", 1, 4), animation: "pop" }] });
    expect(needsCompositor(animated, 0, 5)).toBe(true);

    const noAnimation = project({ overlays: [{ ...createTextOverlay("title", 1, 4), animation: "none" }] });
    expect(needsCompositor(noAnimation, 0, 5)).toBe(false);

    const behind = project({ overlays: [{ ...createTextOverlay("title", 1, 4), layer: "behind" }] });
    expect(needsCompositor(behind, 0, 5)).toBe(true);

    const tracked = project({
      overlays: [{ ...createTextOverlay("title", 1, 4), track: { keyframes: [], offset: { x: 0, y: 0 } } }],
    });
    expect(needsCompositor(tracked, 0, 5)).toBe(true);

    const lottie = project({ overlays: [createLottieOverlay({ assetId: "lot-1", name: "sticker" }, 1, 4)] });
    expect(needsCompositor(lottie, 0, 5)).toBe(true);
    expect(needsCompositor(lottie, 5, 8)).toBe(false);
  });

  it("detects an animated caption preset when captions are on and a cue is in range", () => {
    const base: Partial<VideoProject> = {
      cues: [{ id: "cue-1", start: 0, end: 5, text: "hello" }],
      // "hormozi" enters with the pop animation; "clean" has none.
      subtitleStyle: { ...defaultSubtitleStyle(), presetId: "hormozi" },
    };
    expect(needsCompositor(project(base), 1, 2)).toBe(true);
    expect(needsCompositor(project(base), 5, 6)).toBe(false);

    const hidden = project({ ...base, captions: { ...createProject().captions, visible: false } });
    expect(needsCompositor(hidden, 1, 2)).toBe(false);

    const noHighlight = project({ ...base, subtitleStyle: { ...base.subtitleStyle!, highlight: false } });
    expect(needsCompositor(noHighlight, 1, 2)).toBe(false);

    const staticPreset = project({ ...base, subtitleStyle: { ...base.subtitleStyle!, presetId: "clean" } });
    expect(needsCompositor(staticPreset, 1, 2)).toBe(false);
  });
});
