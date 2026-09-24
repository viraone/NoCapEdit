import { describe, expect, it } from "vitest";
import { encoderArgs, hdrToSdrChain, parseProbeLog } from "@/lib/ffmpegEngine";

describe("parseProbeLog", () => {
  it("detects HDR HLG 10-bit sources", () => {
    const info = parseProbeLog([
      "  Duration: 00:01:02.50, start: 0.000000, bitrate: 48000 kb/s",
      "  Stream #0:0(und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 45000 kb/s, 59.94 fps, 59.94 tbr",
      "  Stream #0:1(und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 192 kb/s",
    ]);
    expect(info.duration).toBeCloseTo(62.5);
    expect(info.video).toMatchObject({ codec: "hevc", width: 3840, height: 2160, bitDepth: 10, colorTransfer: "arib-std-b67", colorPrimaries: "bt2020", isHdr: true });
    expect(info.video?.fps).toBeCloseTo(59.94);
    expect(info.audio).toMatchObject({ codec: "aac", sampleRate: 48000, channels: "stereo" });
  });
  it("treats plain 8-bit bt709 as SDR", () => {
    const info = parseProbeLog(["  Stream #0:0: Video: h264 (High) (avc1 / 0x31637661), yuv420p(tv, bt709), 1920x1080 [SAR 1:1 DAR 16:9], 30 fps"]);
    expect(info.video?.isHdr).toBe(false);
    expect(info.video?.bitDepth).toBe(8);
    expect(info.audio).toBeNull();
  });
});

describe("encoderArgs", () => {
  const base = { width: 2160, height: 3840, fps: 60, codec: "h264" as const, preset: "medium" as const, rateControl: { mode: "bitrate" as const, kbps: 20000 }, audioBitrateKbps: 192, gopSeconds: 2, hdr: "auto" as const };
  it("emits 4K/60 bitrate-controlled x264 flags with fragmented output", () => {
    const args = encoderArgs(base, { fragmented: true, tsOffset: 12.5, duration: 10 }).join(" ");
    expect(args).toContain("-c:v libx264 -preset medium -profile:v high -level 5.1 -b:v 20000k -maxrate 30000k -bufsize 40000k -g 120 -keyint_min 120");
    expect(args).toContain("-r 60");
    expect(args).toContain("-t 10.0000");
    expect(args).toContain("-movflags frag_keyframe+empty_moov+default_base_moof");
    expect(args).toContain("-bf 0");
    expect(args).not.toContain("output_ts_offset");
  });
  it("uses CRF and faststart for single-file output", () => {
    const args = encoderArgs({ ...base, rateControl: { mode: "crf", crf: 20 }, codec: "h265" }, { fragmented: false, tsOffset: 0, duration: 5 }).join(" ");
    expect(args).toContain("-c:v libx265");
    expect(args).toContain("-crf 20");
    expect(args).toContain("-movflags +faststart");
  });
  it("tone-maps through zscale", () => {
    expect(hdrToSdrChain()).toContain("tonemap=tonemap=hable");
  });
});

describe("multi-threaded core thread caps", () => {
  it("keeps the planned thread count inside the pthread pool budget", async () => {
    const { threadPlan, MT_THREAD_BUDGET } = await import("@/lib/ffmpegEngine");
    for (const cores of [2, 4, 8, 18, 64]) {
      for (const inputs of [1, 3, 6, 12, 20]) {
        const p = threadPlan(inputs, cores);
        expect(inputs * p.decoder + p.encoder + 2 * p.filter).toBeLessThanOrEqual(MT_THREAD_BUDGET);
        expect(p.encoder).toBeGreaterThanOrEqual(2);
        expect(p.decoder).toBeGreaterThanOrEqual(1);
      }
    }
    expect(threadPlan(1, 18)).toEqual({ decoder: 2, encoder: 8, filter: 2 });
    expect(threadPlan(1, 4)).toEqual({ decoder: 2, encoder: 4, filter: 1 });
  });

  it("caps every decoder, the encoder and the filter graphs", async () => {
    const { withThreadCaps, countInputs } = await import("@/lib/ffmpegEngine");
    const args = ["-hide_banner", "-y", "-ss", "2", "-t", "4", "-i", "/in/clip0.mp4", "-i", "/in/music.mp3", "-filter_complex", "[0:v]fps=30[v]", "-map", "[v]", "-c:v", "libx264", "out.mp4"];
    expect(countInputs(args)).toBe(2);
    const out = withThreadCaps(args, { decoder: 2, encoder: 8, filter: 2 });
    expect(out.slice(0, 4)).toEqual(["-filter_threads", "2", "-filter_complex_threads", "2"]);
    expect(out.join(" ")).toContain("-t 4 -threads 2 -i /in/clip0.mp4 -threads 2 -i /in/music.mp3");
    expect(out.slice(-3)).toEqual(["-threads", "8", "out.mp4"]);
  });

  it("respects explicit thread options and the null muxer output", async () => {
    const { withThreadCaps } = await import("@/lib/ffmpegEngine");
    const probe = withThreadCaps(["-hide_banner", "-threads", "1", "-i", "/in/a.mp4", "-frames:v", "1", "-f", "null", "-"], { decoder: 2, encoder: 8, filter: 2 });
    expect(probe.join(" ")).toContain("-threads 1 -i /in/a.mp4");
    expect(probe.join(" ")).not.toContain("-threads 2");
    expect(probe.slice(-3)).toEqual(["-threads", "8", "-"]);
    const version = withThreadCaps(["-version"], { decoder: 2, encoder: 8, filter: 2 });
    expect(version).toEqual(["-filter_threads", "2", "-filter_complex_threads", "2", "-version"]);
  });

  it("marks which core hung", async () => {
    const { FFmpegHungError } = await import("@/lib/ffmpegEngine");
    expect(new FFmpegHungError(true).multithreaded).toBe(true);
    expect(new FFmpegHungError(false).message).toContain("stopped responding");
  });

  it("writes the edit list with delay_moov for fragmented output", () => {
    const base = { width: 1280, height: 720, fps: 30, codec: "h264" as const, preset: "veryfast" as const, rateControl: { mode: "crf" as const, crf: 23 }, audioBitrateKbps: 160, gopSeconds: 2, hdr: "auto" as const };
    const args = encoderArgs(base, { fragmented: true, tsOffset: 0, duration: 10 }).join(" ");
    expect(args).toContain("-movflags frag_keyframe+empty_moov+default_base_moof+delay_moov -avoid_negative_ts disabled");
  });
});
