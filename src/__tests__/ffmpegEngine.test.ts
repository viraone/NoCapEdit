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
