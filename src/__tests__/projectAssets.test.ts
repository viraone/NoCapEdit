import { describe, expect, it } from "vitest";
import {
  collectAssetIds,
  createClip,
  createImageOverlay,
  createLottieOverlay,
  createProject,
  createTextOverlay,
  remapAssetIds,
  unusedAssetIds,
  type VideoProject,
} from "@/lib/models/project";

function fullProject(): VideoProject {
  const clip = { ...createClip({ assetId: "video", name: "a", duration: 5, width: 1920, height: 1080, hasAudio: true }), audioAssetId: "clean", look: { lutAssetId: "lut", lutName: "Warm", brightness: 0, contrast: 1, saturation: 1 }, matte: { assetId: "matte", width: 64, height: 64, fps: 4 } as never };
  const bare = createClip({ assetId: "video2", name: "b", duration: 5, width: 1920, height: 1080, hasAudio: true });
  return createProject({
    clips: [clip, { ...bare, audioAssetId: null, look: { lutAssetId: null, lutName: null, brightness: 0, contrast: 1, saturation: 1 } }],
    overlays: [createImageOverlay({ assetId: "image", name: "i", aspect: 1 }, 0, 1), createLottieOverlay({ assetId: "lottie", name: "l" }, 0, 1), createTextOverlay("title", 0, 1)],
    voiceovers: [
      { id: "v1", kind: "voice", assetId: "voice", name: "v", text: "hi", start: 0, duration: 1, volume: 1 },
      { id: "v2", kind: "sfx", assetId: "sfx", name: "Pop", text: "", start: 1, duration: 1, volume: 1 },
    ],
    music: { assetId: "music", name: "m", duration: 10, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: 0, loop: false },
  });
}
const ALL = ["video", "clean", "lut", "matte", "video2", "image", "lottie", "voice", "sfx", "music"];

describe("project asset references", () => {
  it("collects every kind of asset reference and nothing from empty slots or text overlays", () => {
    expect([...collectAssetIds(fullProject())].sort()).toEqual([...ALL].sort());
  });

  it("remaps every reference without mutating the input", () => {
    const p = fullProject();
    const before = JSON.stringify(p);
    const out = remapAssetIds(p, (id) => `${id}_2`);
    expect(JSON.stringify(p)).toBe(before);
    expect([...collectAssetIds(out)].sort()).toEqual(ALL.map((id) => `${id}_2`).sort());
    expect(out.clips[1].audioAssetId).toBeNull();
    expect(out.clips[1].look?.lutAssetId).toBeNull();
    expect(out.overlays[2]).toEqual(p.overlays[2]);
  });

  it("finds only true orphans and keeps assets an import is still writing", () => {
    const stored = [...ALL, "orphan", "inflight"];
    expect(unusedAssetIds(stored, fullProject(), ["inflight"])).toEqual(["orphan"]);
    expect(unusedAssetIds(stored, fullProject())).toEqual(["orphan", "inflight"]);
  });
});
