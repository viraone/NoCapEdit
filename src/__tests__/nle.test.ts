import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { createClip, createProject, createTextOverlay, type Clip, type VideoProject } from "@/lib/models/project";
import { layoutClips } from "@/lib/models/timeline";
import { buildFcpxml, buildXmeml, clipMotion, gainDb, planNle, xml, type NleMedia } from "@/lib/export/nle";

const clip = (id: string, extra: Partial<Clip> = {}): Clip => ({
  ...createClip({ assetId: id, name: `Clip ${id}`, duration: 10, width: 1920, height: 1080, hasAudio: true }),
  ...extra,
});

const media = (extra: Partial<NleMedia> = {}): NleMedia => ({ path: "media/a.mp4", duration: 10, hasVideo: true, hasAudio: true, width: 1920, height: 1080, ...extra });

function sample(): { project: VideoProject; media: Record<string, NleMedia> } {
  const a = clip("a", { inPoint: 1, outPoint: 7, transition: { type: "fade", duration: 1 } });
  const b = clip("b", { inPoint: 0, outPoint: 8, speed: 2, volume: 0.5, zoom: 1.5, transition: { type: "glsl:swirl", duration: 0.5 } });
  const c = clip("c", { hasAudio: false, audioAssetId: "a-clean" });
  const project = createProject({
    name: "My <test> & reel",
    clips: [a, b, c],
    cues: [
      { id: "q1", start: 0.5, end: 2, text: "Hello & welcome" },
      { id: "q2", start: 6, end: 7.5, text: "Second line" },
    ],
    overlays: [createTextOverlay("title", 1, 3)],
    voiceovers: [{ id: "v1", assetId: "vo", name: "Voice", text: "hi", start: 2, duration: 2, volume: 1 }],
    music: { assetId: "song", name: "Song", duration: 30, volume: 0.4, fadeIn: 1, fadeOut: 2, startOffset: 3, loop: false },
  });
  return {
    project,
    media: {
      a: media({ path: "media/01 a.mp4" }),
      b: media({ path: "media/02 b.mp4" }),
      c: media({ path: "media/03 c.mp4", hasAudio: false }),
      "a-clean": media({ path: "media/04 clean.wav", hasVideo: false, duration: 10 }),
      vo: media({ path: "media/05 vo.wav", hasVideo: false, duration: 2 }),
      song: media({ path: "media/06 song.mp3", hasVideo: false, duration: 30 }),
    },
  };
}

describe("planNle", () => {
  it("cuts in the middle of a transition so every clip keeps its project time", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    const layouts = layoutClips(project.clips);
    // The first dissolve (1 s) overlaps clip a's last second with clip b's first.
    expect(plan.items[0].startF).toBe(0);
    expect(plan.items[0].endF).toBe(Math.round((layouts[0].end - layouts[0].transitionOut / 2) * 30));
    expect(plan.items[1].startF).toBe(plan.items[0].endF);
    expect(plan.items[2].startF).toBe(plan.items[1].endF);
    expect(plan.items[2].endF).toBe(plan.durationF);
    expect(plan.items[0].dissolveF).toBe(30);
    expect(plan.items[2].dissolveF).toBe(0);
  });

  it("starts the second clip's source half a transition in, scaled by its speed", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    // Clip b starts at its in point 0; the cut sits 0.5 s into it (half of the 1 s dissolve) at 2x speed.
    expect(plan.items[1].srcIn).toBeCloseTo(0 + 0.5 * 2, 6);
    // Clip a has no head transition: it starts at its in point.
    expect(plan.items[0].srcIn).toBe(1);
  });

  it("places the song, voice-over and cleaned audio by project time", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    const song = plan.sounds.find((s) => s.kind === "music")!;
    expect(song.startF).toBe(0);
    expect(song.srcIn).toBe(3);
    expect(song.endF).toBe(Math.min(plan.durationF, 27 * 30));
    const vo = plan.sounds.find((s) => s.name === "Voice")!;
    expect(vo.startF).toBe(60);
    expect(vo.endF).toBe(120);
    const cleaned = plan.sounds.find((s) => s.assetId === "a-clean")!;
    expect(cleaned.startF).toBe(plan.items[2].startF);
  });

  it("turns captions and text overlays into titles and says what it left out", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    expect(plan.texts.filter((t) => t.caption)).toHaveLength(2);
    expect(plan.texts.filter((t) => !t.caption)).toHaveLength(1);
    expect(plan.notes.some((n) => /transition becomes a cross dissolve|Every transition/.test(n))).toBe(true);
  });

  it("fails when a clip's media is not in the table", () => {
    const { project, media } = sample();
    delete media.b;
    expect(() => planNle(project, { fps: 30, media })).toThrow(/missing/);
  });

  it("maps zoom to a scale on the source's own pixels", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    const frame = { width: plan.width, height: plan.height };
    // 1920x1080 source cover-fitted into a 1080x1920 frame, then 1.5x zoomed.
    const m = clipMotion(plan.items[1], frame);
    expect(m.scale).toBeCloseTo((1920 / 1080) * 1.5, 6);
    expect(m.dx).toBeCloseTo(0, 6);
  });
});

describe("FCPXML and xmeml text", () => {
  it("escapes names and writes a well-formed spine", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    const out = buildFcpxml(plan);
    expect(out).toContain("My &lt;test&gt; &amp; reel");
    expect(out).not.toContain("My <test>");
    expect(out).toContain("Hello &amp; welcome");
    expect(out.match(/<spine>/g)).toHaveLength(1);
    expect(out.match(/<asset-clip /g)!.length).toBeGreaterThanOrEqual(plan.items.length + plan.sounds.length);
    expect(out).toContain('<transition name="Cross Dissolve"');
    expect(out).toContain("<timeMap>");
    // Every ref points at a resource that exists.
    const ids = new Set([...out.matchAll(/<(?:asset|format|effect) id="([^"]+)"/g)].map((m) => m[1]));
    for (const m of out.matchAll(/ (?:ref|format)="((?!ts\d)[^"]+)"/g)) expect(ids.has(m[1])).toBe(true);
  });

  it("writes a sequence as long as the project and one track per sound", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 24, media });
    const out = buildXmeml(plan);
    expect(out).toContain(`<duration>${plan.durationF}</duration>`);
    expect(out).toContain("<transitionitem>");
    expect(out).toContain("Time Remap");
    expect(out.match(/<track premiereTrackType="Stereo">/g)!.length).toBe(1 + plan.sounds.length);
    expect(out).not.toContain("Hello");
  });

  it("converts gain to decibels", () => {
    expect(gainDb(1)).toBe(0);
    expect(gainDb(0.5)).toBeCloseTo(-6.0206, 3);
    expect(gainDb(0)).toBe(-96);
  });

  it("drops control characters from XML", () => {
    expect(xml("a\u0001b<c>")).toBe("ab&lt;c&gt;");
  });
});

// Writes the two files out for a manual DTD check: NLE_DUMP_DIR=/some/dir npx vitest run nle
describe.skipIf(!process.env.NLE_DUMP_DIR)("dump", () => {
  it("writes the sample timeline", () => {
    const { project, media } = sample();
    const plan = planNle(project, { fps: 30, media });
    mkdirSync(process.env.NLE_DUMP_DIR!, { recursive: true });
    writeFileSync(`${process.env.NLE_DUMP_DIR}/sample.fcpxml`, buildFcpxml(plan));
    writeFileSync(`${process.env.NLE_DUMP_DIR}/sample.xml`, buildXmeml(plan));
  });
});
