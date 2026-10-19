import { describe, expect, it } from "vitest";
import { createClip, createProject, createTextOverlay, type VideoProject } from "@/lib/models/project";
import { hasBlockingIssue, insideFrame, runPreflight, type PreflightEnv } from "@/lib/export/preflight";
import type { Ctx } from "@/lib/captions/renderer";

/** A canvas context that draws nothing and measures every character as `charWidth` pixels. */
function fakeContext(charWidth = 10): Ctx {
  return new Proxy(
    {},
    {
      get: (_t, prop) => (prop === "measureText" ? (s: string) => ({ width: s.length * charWidth }) : () => undefined),
      set: () => true,
    },
  ) as unknown as Ctx;
}

const env = (over: Partial<PreflightEnv> = {}): PreflightEnv => ({
  assetState: async () => "ok",
  missingFonts: async () => [],
  context: () => fakeContext(),
  ...over,
});

function project(extra: Partial<VideoProject> = {}): VideoProject {
  return createProject({
    clips: [createClip({ assetId: "a", name: "Interview", duration: 10, width: 1920, height: 1080, hasAudio: true })],
    ...extra,
  });
}

describe("runPreflight", () => {
  it("passes a plain project", async () => {
    expect(await runPreflight(project(), env())).toEqual([]);
  });

  it("blocks an empty timeline", async () => {
    const issues = await runPreflight(createProject(), env());
    expect(issues).toHaveLength(1);
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("names the missing and the unreadable media and blocks the export", async () => {
    const p = project({ music: { assetId: "song", name: "Beat", duration: 30, volume: 1, fadeIn: 0, fadeOut: 0, startOffset: 0, loop: false } });
    const issues = await runPreflight(p, env({ assetState: async (id) => (id === "a" ? "missing" : "unreadable") }));
    expect(issues.map((i) => i.id)).toEqual(["media-missing", "media-unreadable"]);
    expect(issues[0].detail).toContain("Interview");
    expect(issues[1].detail).toContain("Beat");
    expect(hasBlockingIssue(issues)).toBe(true);
  });

  it("warns about text that runs off the frame", async () => {
    const wide = { ...createTextOverlay("title", 0, 5), text: "x".repeat(200), maxWidth: 3, fontSize: 0.05 };
    const fine = { ...createTextOverlay("title", 0, 5), text: "Short" };
    const issues = await runPreflight(project({ overlays: [wide, fine] }), env());
    const cut = issues.filter((i) => i.id.startsWith("text-cut-"));
    expect(cut).toHaveLength(1);
    expect(cut[0].id).toBe(`text-cut-${wide.id}`);
    expect(cut[0].target?.select).toEqual({ kind: "overlay", id: wide.id });
    expect(hasBlockingIssue(issues)).toBe(false);
  });

  it("does not call a full-width banner cut off", async () => {
    const banner = { ...createTextOverlay("banner", 0, 5), text: "Sale today" };
    expect(await runPreflight(project({ overlays: [banner] }), env())).toEqual([]);
  });

  it("reports one warning for captions past the edge, with the first time", async () => {
    const cues = [
      { id: "c1", start: 1, end: 2, text: "ok" },
      { id: "c2", start: 3, end: 4, text: "word ".repeat(100) },
    ];
    const issues = await runPreflight(project({ cues }), env({ context: () => fakeContext(60) }));
    const hit = issues.find((i) => i.id === "captions-cut");
    expect(hit).toBeTruthy();
    expect(hit!.target?.select).toEqual({ kind: "cue", id: expect.any(String) });
  });

  it("flags missing fonts only for fonts the project uses", async () => {
    let asked: string[] = [];
    const t = { ...createTextOverlay("title", 0, 5), fontFamily: "bangers" as const };
    const issues = await runPreflight(project({ overlays: [t] }), env({ missingFonts: async (w) => ((asked = w.map((x) => x.key)), ["bangers"]) }));
    expect(asked).toEqual(["bangers"]);
    expect(issues.find((i) => i.id === "fonts")?.detail).toContain("Bangers");
  });

  it("flags things that start after the video ends, and empty text", async () => {
    const late = { ...createTextOverlay("title", 12, 14), text: "Too late" };
    const blank = { ...createTextOverlay("title", 0, 2), text: "  " };
    const issues = await runPreflight(project({ overlays: [late, blank], cues: [{ id: "q", start: 11, end: 12, text: "x" }] }), env());
    expect(issues.map((i) => i.id).sort()).toEqual(["cues-late", "overlays-late", "text-blank"]);
  });

  it("counts captions that have no translation when the translation is chosen", async () => {
    const cues = [
      { id: "a", start: 0, end: 1, text: "one", translatedText: "uno" },
      { id: "b", start: 1, end: 2, text: "two" },
    ];
    const issues = await runPreflight(project({ cues }), env(), { captionSource: "translated" });
    expect(issues.find((i) => i.id === "untranslated")?.title).toContain("1 of 2");
    expect((await runPreflight(project({ cues }), env(), { captionSource: "original" })).some((i) => i.id === "untranslated")).toBe(false);
  });

  it("leaves captions and text alone when they are switched off for the export", async () => {
    const wide = { ...createTextOverlay("title", 0, 5), text: "x".repeat(200), maxWidth: 3 };
    expect(await runPreflight(project({ overlays: [wide] }), env(), { includeOverlays: false })).toEqual([]);
  });
});

describe("insideFrame", () => {
  it("allows a couple of pixels of rounding", () => {
    const frame = { width: 100, height: 100 };
    expect(insideFrame({ x: -1, y: 0, w: 101, h: 100 }, frame)).toBe(true);
    expect(insideFrame({ x: -5, y: 0, w: 100, h: 100 }, frame)).toBe(false);
    expect(insideFrame({ x: 0, y: 0, w: 100, h: 110 }, frame)).toBe(false);
  });
});
