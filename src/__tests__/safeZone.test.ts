import { describe, expect, it } from "vitest";
import { createProject } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";

describe("safe zone", () => {
  it("starts off for a new project, whatever the format", () => {
    expect(createProject().safeZone).toBe("none");
    expect(createProject({ formatId: "tiktok" }).safeZone).toBe("none");
  });

  it("still knows which mask the Safe zone button should show for a format", () => {
    expect(getFormat("ig-reels").safeZone).toBe("reels");
    expect(getFormat("tiktok").safeZone).toBe("tiktok");
    expect(getFormat("square").safeZone).toBe("none");
  });
});
