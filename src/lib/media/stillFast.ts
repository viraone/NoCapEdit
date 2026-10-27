/**
 * The quick way to turn one picture into a silent video: the browser's own video encoder (WebCodecs, on
 * the graphics chip where there is one) instead of ffmpeg.wasm. A five-minute picture that takes ffmpeg
 * over a minute takes a few seconds here, and ffmpeg's download is not needed at all.
 *
 * Everything here answers "no" (null) rather than throwing when the browser can't do it, so the caller
 * falls back to ffmpeg and the picture is made either way.
 */

/** A picture does not move, so a keyframe every 10 s is plenty (the default of 2 s would make a big file), and few enough that jumping around the timeline stays quick. */
const KEY_FRAME_SECONDS = 10;
/** Past this length the picture is made at one frame a second: 300 copies of a flyer, not 1500. */
const LONG_SECONDS = 30;
const LONG_FPS = 1;

/** The first picture of a video file, or null when this browser can't decode it that way. */
export async function firstFrameCanvas(blob: Blob): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
  if (typeof VideoDecoder === "undefined") return null;
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !(await track.canDecode())) return null;
      const first = await new mb.CanvasSink(track).getCanvas(await track.getFirstTimestamp());
      return first?.canvas ?? null;
    } finally {
      input.dispose();
    }
  } catch {
    return null;
  }
}

/** The picture on `canvas` as an MP4 of `seconds`, or null when the browser can't encode it quickly. */
export async function stillVideoFast(canvas: HTMLCanvasElement | OffscreenCanvas, seconds: number, wantedFps: number, name: string, onStatus?: (message: string) => void): Promise<File | null> {
  if (typeof VideoEncoder === "undefined") return null;
  const fps = seconds > LONG_SECONDS ? Math.min(wantedFps, LONG_FPS) : wantedFps;
  try {
    const mb = await import("mediabunny");
    const { width, height } = canvas;
    // Plenty for a picture; the later frames are copies of the first and cost next to nothing.
    const bitrate = Math.min(16_000_000, Math.max(4_000_000, Math.round(width * height * 4)));
    if (!(await mb.canEncodeVideo("avc", { width, height, bitrate }))) return null;
    const target = new mb.BufferTarget();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: "in-memory" }), target });
    const source = new mb.CanvasSource(canvas, { codec: "avc", bitrate, keyFrameInterval: KEY_FRAME_SECONDS });
    output.addVideoTrack(source, { frameRate: fps });
    await output.start();
    const frames = Math.max(1, Math.round(seconds * fps));
    const step = 1 / fps;
    for (let i = 0; i < frames; i++) {
      await source.add(i * step, step);
      if (i % 100 === 0) onStatus?.(`Rendering the picture, ${Math.round((i / frames) * 100)}%`);
    }
    await output.finalize();
    if (!target.buffer) return null;
    return new File([target.buffer], `${name.replace(/\.[^.]+$/, "")}.mp4`, { type: "video/mp4" });
  } catch {
    return null;
  }
}
