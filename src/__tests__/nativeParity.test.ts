/**
 * Runs the exact ffmpeg command the exporter generates through the native
 * ffmpeg binary (when installed) against the e2e fixture, so filter-graph
 * regressions surface without a browser.
 */
import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClip } from "@/lib/models/project";
import { layoutClips } from "@/lib/models/timeline";
import { computePlacement } from "@/lib/models/placement";
import { buildFilterGraph, buildInputArgs, type ExportPlan } from "@/lib/ffmpeg/filters";
import { encoderArgs } from "@/lib/ffmpegEngine";
import { planSegments } from "@/lib/ffmpeg/segments";
import { parseTrackTiming, renumberFragments, shiftFragments, stripInitSegment, stripTrailingIndex, type TrackTiming } from "@/lib/ffmpeg/mp4";
import { readFileSync } from "node:fs";

const FIXTURE = join(process.cwd(), "e2e", "fixtures", "test-speech.mp4");
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return existsSync(FIXTURE);
  } catch {
    return false;
  }
})();


describe.skipIf(!hasFfmpeg)("native ffmpeg parity", () => {
  it("encodes a two-clip crossfade with an overlay layer, segmented", () => {
    const frame = { width: 720, height: 1280 };
    const a = { ...createClip({ assetId: "a", name: "a", duration: 8.19, width: 640, height: 360, hasAudio: true }), transition: { type: "fade" as const, duration: 0.5 } };
    const b = createClip({ assetId: "a", name: "b", duration: 8.19, width: 640, height: 360, hasAudio: true });
    const segments = planSegments([a, b], 10);
    expect(segments.length).toBe(2);
    const dir = mkdtempSync(join(tmpdir(), "reelflow-parity-"));
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black@0.0:s=64x64,format=rgba", "-frames:v", "1", join(dir, "blank.png")]);
    writeFileSync(join(dir, "list.txt"), "ffconcat version 1.0\nfile blank.png\nduration 1.0\nfile blank.png\nduration 2.0\nfile blank.png\n");
    const total = layoutClips([a, b])[1].end;
    const pieces: Uint8Array[] = [];
    let seq = 1;
    let tracks: Map<number, TrackTiming> | null = null;
    for (const seg of segments) {
      const layouts = layoutClips(seg.clips);
      const plan: ExportPlan = {
        width: frame.width,
        height: frame.height,
        fps: 30,
        duration: seg.end - seg.start,
        clips: layouts.map((layout, i) => ({
          inputIndex: i,
          layout,
          placement: computePlacement({ width: layout.clip.width, height: layout.clip.height }, layout.clip, frame),
          source: { width: layout.clip.width, height: layout.clip.height },
          hasAudio: true,
        })),
        overlayInput: layouts.length,
        framesInput: null,
        music: null,
        voiceovers: [],
        tsOffset: seg.start,
        audioTailTrim: seg.index < segments.length - 1 ? 1024 / 48000 : 0,
      };
      const out = join(dir, `seg${seg.index}.mp4`);
      const { graph, vout, aout } = buildFilterGraph(plan);
      const args = [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        ...buildInputArgs(plan, { clips: layouts.map(() => FIXTURE), overlayList: join(dir, "list.txt"), framesPattern: null, music: null, voiceovers: [], output: out }),
        "-filter_complex",
        graph,
        "-map",
        `[${vout}]`,
        "-map",
        `[${aout}]`,
        ...encoderArgs(
          { width: frame.width, height: frame.height, fps: 30, codec: "h264", preset: "ultrafast", rateControl: { mode: "crf", crf: 28 }, audioBitrateKbps: 96, gopSeconds: 2, hdr: "auto" },
          { fragmented: true, tsOffset: seg.start, duration: seg.end - seg.start },
        ),
        out,
      ];
      execFileSync("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"], timeout: 120_000 });
      expect(statSync(out).size).toBeGreaterThan(1000);
      const probeText = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:format=start_time:stream=codec_type,start_time,duration", "-of", "json", out]).toString();
      const probe = JSON.parse(probeText);
      const dur = Number(probe.format.duration);
      if (!(Math.abs(dur - (seg.end - seg.start)) < 0.25)) console.log(`segment ${seg.index} (${dir}) probe:`, probeText);
      expect(Math.abs(dur - (seg.end - seg.start))).toBeLessThan(0.25);
      let data: Uint8Array = new Uint8Array(readFileSync(out));
      if (seg.index === 0) {
        data = stripTrailingIndex(data);
        tracks = parseTrackTiming(data);
        expect(tracks.size).toBe(2);
      } else {
        data = stripInitSegment(data);
        shiftFragments(data, seg.start, tracks!);
      }
      seq = renumberFragments(data, seq);
      pieces.push(data);
    }
    expect(total).toBeCloseTo(15.88, 1);
    // Splice exactly like the streaming sink does and validate the whole file.
    const spliced = join(dir, "spliced.mp4");
    writeFileSync(spliced, Buffer.concat(pieces.map((p) => Buffer.from(p))));
    const info = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", spliced]).toString());
    expect(Math.abs(Number(info.format.duration) - total)).toBeLessThan(0.3);
    expect(info.streams.map((s: { codec_type: string }) => s.codec_type).sort()).toEqual(["audio", "video"]);
    const decode = spawnSync("ffmpeg", ["-v", "error", "-i", spliced, "-f", "null", "-"], { encoding: "utf8" });
    expect(decode.stderr.trim()).toBe("");
    expect(decode.status).toBe(0);
    const last = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time", "-of", "csv=p=0", spliced]).toString().trim().split("\n");
    expect(Number(last[last.length - 1])).toBeGreaterThan(total - 0.2);
  }, 180_000);
});
