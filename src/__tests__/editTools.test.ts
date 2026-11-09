import { describe, expect, it } from "vitest";
import { createClip, createProject, type VideoProject } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { formatTime, describeProject } from "@/lib/chat/projectContext";
import { EDIT_TOOLS, runEditTool, toolNeedsRipple } from "@/lib/chat/editTools";

function makeProject(): VideoProject {
  const clip = createClip({ assetId: "a", name: "Clip A", duration: 10, width: 1920, height: 1080, hasAudio: true });
  return createProject({ clips: [clip] });
}

describe("formatTime", () => {
  it("formats seconds as m:ss.s", () => {
    expect(formatTime(0)).toBe("0:00.0");
    expect(formatTime(9)).toBe("0:09.0");
    expect(formatTime(65.34)).toBe("1:05.3");
    expect(formatTime(-1)).toBe("0:00.0");
    expect(formatTime(NaN)).toBe("0:00.0");
  });
});

describe("describeProject", () => {
  it("handles a project with no clips", () => {
    const p = createProject();
    const s = describeProject(p);
    expect(s).toContain("Reel length: 0:00.0 (0.0 s).");
    expect(s).toContain("No clips yet.");
    expect(s).toContain("Transcript: none yet. Nothing is known about what is said. Call transcribe to get one.");
  });

  it("lists clips with reel and source times", () => {
    const a = createClip({ assetId: "a", name: "A", duration: 5, width: 100, height: 100, hasAudio: true });
    const b = createClip({ assetId: "b", name: "B", duration: 5, width: 100, height: 100, hasAudio: false });
    const p = createProject({ clips: [a, b] });
    const s = describeProject(p);
    expect(s).toContain('1. id=' + a.id + ' "A" reel 0:00.0-0:05.0, source 0:00.0-0:05.0, speed 1x, has audio');
    expect(s).toContain('2. id=' + b.id + ' "B" reel 0:05.0-0:10.0, source 0:00.0-0:05.0, speed 1x, no audio');
  });

  it("lists cues in order", () => {
    const p = createProject({
      cues: [
        { id: "c1", start: 0, end: 1, text: "Hello" },
        { id: "c2", start: 1, end: 2, text: "World" },
      ],
    });
    const s = describeProject(p);
    expect(s).toContain("Transcript (2 captions, reel time):");
    expect(s.indexOf("[c1] 0:00.0-0:01.0 Hello")).toBeGreaterThan(-1);
    expect(s.indexOf("[c2] 0:01.0-0:02.0 World")).toBeGreaterThan(s.indexOf("[c1]"));
  });

  it("cuts off the transcript when maxTranscriptChars is tiny", () => {
    const p = createProject({
      cues: [
        { id: "c1", start: 0, end: 1, text: "Hello" },
        { id: "c2", start: 1, end: 2, text: "World" },
      ],
    });
    const s = describeProject(p, { maxTranscriptChars: 10 });
    expect(s).toContain("(transcript cut off here to save space; it continues to 0:02.0)");
  });
});

describe("EDIT_TOOLS", () => {
  it("has exactly the 8 expected tools with valid parameters", () => {
    const names = EDIT_TOOLS.map((t) => t.function.name);
    expect(names).toEqual(["transcribe", "cut_ranges", "split_at", "remove_clip", "move_clip", "set_clip_speed", "set_caption_text", "delete_caption"]);
    for (const t of EDIT_TOOLS) {
      expect(t.type).toBe("function");
      expect(typeof t.function.description).toBe("string");
      expect(t.function.parameters).toBeTypeOf("object");
    }
  });
});

describe("runEditTool", () => {
  it("cut_ranges removes a range and reports the new length", () => {
    const p = makeProject();
    const r = runEditTool(p, "cut_ranges", { ranges: [{ start: 0, end: 4 }] });
    expect(r.ok).toBe(true);
    expect(r.message).toContain("Removed 4.0 s.");
    expect(r.message).toContain("0:06.0");
    expect(projectDuration(p.clips)).toBeCloseTo(6, 5);
  });

  it("cut_ranges rejects bad input and leaves the project unchanged", () => {
    const p = makeProject();
    const before = projectDuration(p.clips);
    for (const args of [
      { ranges: [{ start: 4, end: 0 }] },
      { ranges: [{ start: "0", end: 4 }] },
      { ranges: [] },
    ]) {
      const r = runEditTool(p, "cut_ranges", args);
      expect(r.ok).toBe(false);
      expect(projectDuration(p.clips)).toBeCloseTo(before, 5);
    }
  });

  it("split_at splits inside a clip and refuses at the edge", () => {
    const p = makeProject();
    const r = runEditTool(p, "split_at", { time: 5 });
    expect(r.ok).toBe(true);
    expect(p.clips.length).toBe(2);
    const r2 = runEditTool(p, "split_at", { time: 0.05 });
    expect(r2.ok).toBe(false);
  });

  it("remove_clip removes a clip", () => {
    const p = makeProject();
    const id = p.clips[0].id;
    const r = runEditTool(p, "remove_clip", { clip_id: id });
    expect(r.ok).toBe(true);
    expect(p.clips.length).toBe(0);
  });

  it("move_clip moves a clip", () => {
    const a = createClip({ assetId: "a", name: "A", duration: 5, width: 100, height: 100, hasAudio: true });
    const b = createClip({ assetId: "b", name: "B", duration: 5, width: 100, height: 100, hasAudio: true });
    const p = createProject({ clips: [a, b] });
    const r = runEditTool(p, "move_clip", { clip_id: b.id, direction: "earlier" });
    expect(r.ok).toBe(true);
    expect(p.clips[0].id).toBe(b.id);
  });

  it("set_clip_speed accepts in-range and rejects out-of-range", () => {
    const p = makeProject();
    const id = p.clips[0].id;
    expect(runEditTool(p, "set_clip_speed", { clip_id: id, speed: 2 }).ok).toBe(true);
    expect(p.clips[0].speed).toBe(2);
    expect(runEditTool(p, "set_clip_speed", { clip_id: id, speed: 5 }).ok).toBe(false);
    expect(runEditTool(p, "set_clip_speed", { clip_id: id, speed: 0.1 }).ok).toBe(false);
  });

  it("set_caption_text updates text and drops words", () => {
    const p = createProject({
      cues: [{ id: "c1", start: 0, end: 1, text: "Hello", words: [{ text: "Hello", start: 0, end: 0.5 }] }],
    });
    const r = runEditTool(p, "set_caption_text", { cue_id: "c1", text: "  Hi  " });
    expect(r.ok).toBe(true);
    expect(p.cues[0].text).toBe("Hi");
    expect(p.cues[0].words).toBeUndefined();
    expect(runEditTool(p, "set_caption_text", { cue_id: "c1", text: "   " }).ok).toBe(false);
  });

  it("delete_caption removes a cue", () => {
    const p = createProject({ cues: [{ id: "c1", start: 0, end: 1, text: "Hello" }] });
    const r = runEditTool(p, "delete_caption", { cue_id: "c1" });
    expect(r.ok).toBe(true);
    expect(p.cues.length).toBe(0);
  });

  it("handles unknown tools and non-object args without throwing", () => {
    const p = makeProject();
    expect(runEditTool(p, "nope", {}).ok).toBe(false);
    expect(runEditTool(p, "cut_ranges", 42).ok).toBe(false);
    expect(runEditTool(p, "transcribe", {}).ok).toBe(false);
  });
});

describe("toolNeedsRipple", () => {
  it("is on for tools that change clips and off for cut_ranges and caption edits", () => {
    for (const n of ["split_at", "remove_clip", "move_clip", "set_clip_speed"]) expect(toolNeedsRipple(n)).toBe(true);
    for (const n of ["cut_ranges", "set_caption_text", "delete_caption", "transcribe"]) expect(toolNeedsRipple(n)).toBe(false);
  });
});
