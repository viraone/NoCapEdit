import { describe, it, expect } from "vitest";
import { exportFits } from "@/lib/phone/exportFits";
import type { VideoProject } from "@/lib/models/project";

const p = (id: string, name: string, updatedAt: number, clips: unknown[]) =>
  ({ id, name, updatedAt, clips }) as unknown as VideoProject;

describe("exportFits", () => {
  it("same content true", () => {
    const a = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    const b = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    expect(exportFits({ project: a }, b)).toBe(true);
  });

  it("only updatedAt differs true", () => {
    const a = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    const b = p("a", "One", 2, [{ id: "c1", in: 0 }]);
    expect(exportFits({ project: a }, b)).toBe(true);
  });

  it("another id with identical content false", () => {
    const a = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    const b = p("b", "One", 1, [{ id: "c1", in: 0 }]);
    expect(exportFits({ project: a }, b)).toBe(false);
  });

  it("a changed name false", () => {
    const a = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    const b = p("a", "Two", 1, [{ id: "c1", in: 0 }]);
    expect(exportFits({ project: a }, b)).toBe(false);
  });

  it("a changed clip value false", () => {
    const a = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    const b = p("a", "One", 1, [{ id: "c1", in: 1 }]);
    expect(exportFits({ project: a }, b)).toBe(false);
  });

  it("null done false", () => {
    const b = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    expect(exportFits(null, b)).toBe(false);
  });

  it("null project false", () => {
    const a = p("a", "One", 1, [{ id: "c1", in: 0 }]);
    expect(exportFits({ project: a }, null)).toBe(false);
  });
});
