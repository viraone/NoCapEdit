import { describe, expect, it } from "vitest";
import { createClip } from "@/lib/models/project";
import { layoutClips } from "@/lib/models/timeline";
import { computePlacement } from "@/lib/models/placement";
import { buildExportArgs, buildFilterGraph, cropRegion, speedFilters, type ExportPlan } from "@/lib/ffmpeg/filters";

const frame = { width: 1080, height: 1920 };
function plan(clips: ReturnType<typeof createClip>[], extra: Partial<ExportPlan> = {}): ExportPlan {
  const layouts = layoutClips(clips);
  return {
    width: frame.width,
    height: frame.height,
    fps: 30,
    duration: layouts[layouts.length - 1].end,
    clips: layouts.map((layout, i) => ({
      inputIndex: i,
      layout,
      placement: computePlacement({ width: layout.clip.width, height: layout.clip.height }, layout.clip, frame),
      source: { width: layout.clip.width, height: layout.clip.height },
      hasAudio: layout.clip.hasAudio,
    })),
    overlayInput: null,
    framesInput: null,
    music: null,
    voiceovers: [],
    ...extra,
  };
}
const clip = (duration: number, extra = {}) => ({ ...createClip({ assetId: "a", name: "c", duration, width: 1920, height: 1080, hasAudio: true }), ...extra });

describe("speedFilters", () => {
  it("chains atempo within the 0.5–2 range", () => {
    expect(speedFilters(4, true)).toEqual(["atempo=2", "atempo=2"]);
    expect(speedFilters(0.25, true)).toEqual(["atempo=0.5", "atempo=0.5"]);
    expect(speedFilters(3, true)).toEqual(["atempo=2", "atempo=1.5"]);
    expect(speedFilters(1, true)).toEqual([]);
  });
  it("uses asetrate when pitch should follow speed", () => {
    expect(speedFilters(2, false)).toEqual(["asetrate=96000", "aresample=48000"]);
  });
});

describe("cropRegion", () => {
  it("returns an in-bounds crop for cover-fitted sources", () => {
    const p = computePlacement({ width: 1920, height: 1080 }, { zoom: 1, pan: { x: 0, y: 0 } }, frame);
    const c = cropRegion(p, { width: 1920, height: 1080 }, frame)!;
    expect(c).not.toBeNull();
    expect(c.w).toBeCloseTo(608, -1);
    expect(c.h).toBe(1080);
  });
  it("returns null when the frame shows padding", () => {
    const p = computePlacement({ width: 1920, height: 1080 }, { zoom: 0.5, pan: { x: 0, y: 0 } }, frame);
    expect(cropRegion(p, { width: 1920, height: 1080 }, frame)).toBeNull();
  });
});

describe("buildFilterGraph", () => {
  it("concatenates cuts and crossfades transitions", () => {
    const a = clip(4, { transition: { type: "fade", duration: 1 } });
    const b = clip(4);
    const c = clip(2);
    const { graph } = buildFilterGraph(plan([a, b, c]));
    expect(graph).toContain("xfade=transition=fade:duration=1:offset=3[vx1]");
    expect(graph).toContain("acrossfade=d=1");
    expect(graph).toContain("[vx1][v2]concat=n=2:v=1:a=0[vx2]");
    expect(graph).toContain("[ax1][a2]concat=n=2:v=0:a=1[ax2]");
    expect(graph).toContain("[vx2]format=yuv420p,fps=30,tpad=stop_mode=clone:stop_duration=0.033333[vout]");
    expect(graph).toContain("[ax2]anull[aout]");
  });
  it("synthesises silence for clips without audio and mixes music", () => {
    const a = clip(3, { hasAudio: false });
    const { graph } = buildFilterGraph(plan([a], { music: { inputIndex: 1, volume: 0.4, fadeIn: 1, fadeOut: 2, segmentStart: 10, totalDuration: 13 } }));
    expect(graph).toContain("anullsrc=r=48000:cl=stereo,atrim=duration=3");
    expect(graph).toContain("volume=volume='0.4*clip(min((t+10)/1,(13-t-10)/2),0,1)':eval=frame");
    expect(graph).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0,anull[aout]");
  });
  it("overlays the caption layer when present", () => {
    const { graph } = buildFilterGraph(plan([clip(3)], { overlayInput: 1 }));
    expect(graph).toContain("[v0][1:v]overlay=x=0:y=0:eof_action=repeat[vov]");
  });
});

describe("compositor and mix inputs", () => {
  it("uses the frame sequence as the video base and mixes voice-overs", () => {
    const { graph } = buildFilterGraph(plan([clip(4), clip(4)], { framesInput: 2, voiceovers: [{ inputIndex: 3, headTrim: 0, delay: 1.5, volume: 1 }] }));
    expect(graph).toContain("[2:v]fps=30,format=yuv420p,setsar=1,trim=duration=8,setpts=PTS-STARTPTS[vbase]");
    expect(graph).not.toContain("xfade");
    expect(graph).toContain("[a0][a1]concat=n=2:v=0:a=1[ax1]");
    expect(graph).toContain("adelay=delays=1500:all=1");
    expect(graph).toContain("[ax1][vo0]amix=inputs=2");
  });
  it("prefers replacement audio inputs and tone-maps HDR sources", () => {
    const p = plan([clip(3)]);
    p.clips[0].audioInputIndex = 1;
    p.clips[0].hdr = true;
    const { graph } = buildFilterGraph(p);
    expect(graph).toContain("[1:a]asetpts=PTS-STARTPTS");
    expect(graph).toContain("[0:v]zscale=t=linear:npl=100");
  });
});

describe("buildExportArgs", () => {
  it("seeks inputs by in/out points and maps the outputs", () => {
    const a = clip(10, { inPoint: 2, outPoint: 6 });
    const args = buildExportArgs(plan([a]), { clips: ["/mnt/clip0.mp4"], overlayList: null, framesPattern: null, music: null, voiceovers: [], output: "out.mp4" }, { preset: "veryfast", crf: 23 });
    expect(args.slice(0, 8)).toEqual(["-hide_banner", "-y", "-ss", "2", "-t", "4", "-i", "/mnt/clip0.mp4"]);
    expect(args).toContain("-filter_complex");
    expect(args[args.length - 1]).toBe("out.mp4");
    expect(args.join(" ")).toContain("-c:v libx264 -preset veryfast -crf 23");
  });
});
