import { describe, expect, it } from "vitest";
import { railLayout } from "@/components/panels/ToolRail";

const TOOLS = 9;
/** Height the column of tools takes at a layout: buttons (tile, padding, label line) plus gaps and the rail padding. */
const used = (l: ReturnType<typeof railLayout>) => TOOLS * (l.tile + 2 * l.padY + (l.labels ? 20 : 0)) + (TOOLS - 1) * 4 + 16;

describe("railLayout (tool rail fills its height)", () => {
  it("never needs more height than it gets, unless the tiles are already at their smallest", () => {
    for (let h = 250; h <= 1400; h += 7) {
      const l = railLayout(h, TOOLS);
      if (l.tile > 26) expect(used(l)).toBeLessThanOrEqual(h);
    }
  });

  it("grows the icons on a typical laptop height instead of leaving the bottom empty", () => {
    const l = railLayout(500, TOOLS);
    expect(l.tile).toBeGreaterThanOrEqual(42);
    expect(l.icon).toBeGreaterThanOrEqual(22);
    expect(used(l)).toBeGreaterThan(500 * 0.85);
  });

  it("brings the labels back once there is room for them", () => {
    expect(railLayout(560, TOOLS).labels).toBe(false);
    const tall = railLayout(800, TOOLS);
    expect(tall.labels).toBe(true);
    expect(tall.tile).toBeGreaterThanOrEqual(44);
  });

  it("never shrinks the icons as the rail gets taller", () => {
    let last = 0;
    for (let h = 300; h <= 1400; h += 3) {
      const t = railLayout(h, TOOLS).tile;
      expect(t).toBeGreaterThanOrEqual(Math.min(last, 44));
      last = t;
    }
  });

  it("keeps growing only up to a cap", () => {
    expect(railLayout(2000, TOOLS).tile).toBe(48);
  });
});
