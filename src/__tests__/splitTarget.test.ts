import { describe, expect, it } from "vitest";
import { createClip } from "@/lib/models/project";
import { layoutClips } from "@/lib/models/timeline";
import { splitTarget } from "@/lib/models/clipOps";

const clip = (id: string, duration: number, transition?: number) => ({
  ...createClip({ assetId: "a", name: id, duration, width: 1920, height: 1080, hasAudio: true }),
  id,
  ...(transition ? { transition: { type: "fade" as const, duration: transition } } : {}),
});

describe("splitTarget (what a click on the timeline would cut)", () => {
  const layouts = layoutClips([clip("A", 10), clip("B", 6)]);

  it("names the clip under the time", () => {
    expect(splitTarget(layouts, 4)?.clip.id).toBe("A");
    expect(splitTarget(layouts, 12)?.clip.id).toBe("B");
  });

  it("refuses within 0.1 s of a clip edge, so a second click on a fresh cut does nothing", () => {
    expect(splitTarget(layouts, 0.05)).toBeNull();
    expect(splitTarget(layouts, 9.95)).toBeNull();
    expect(splitTarget(layouts, 10)).toBeNull();
    expect(splitTarget(layouts, 10.05)).toBeNull();
  });

  it("refuses past the end of the timeline", () => {
    expect(splitTarget(layouts, 20)).toBeNull();
  });

  it("refuses inside a transition, where two clips play at once", () => {
    const withFade = layoutClips([clip("A", 10, 1), clip("B", 6)]);
    const b = withFade[1];
    expect(b.transitionIn).toBeGreaterThan(0);
    expect(splitTarget(withFade, b.start + b.transitionIn / 2)).toBeNull();
    expect(splitTarget(withFade, b.start + b.transitionIn + 1)?.clip.id).toBe("B");
  });
});
