/**
 * Cuts several pieces out of one source video and joins them, in a single
 * ffmpeg run. One run matters for a long show: the desktop app copies the
 * source into ffmpeg's folder once, not once per piece.
 */
import { withDeadline } from "@/lib/ffmpeg/deadline";
import { ffmpegEngine } from "@/lib/ffmpegEngine";

export interface Piece {
  /** Seconds in the source file. */
  start: number;
  seconds: number;
}

export interface CutPiecesOptions {
  signal?: AbortSignal;
  /** Share of the cut done so far, 0..1. */
  onProgress?: (fraction: number) => void;
  /** Engine start-up and file-opening messages. */
  onStatus?: (message: string) => void;
}

const READ_SECONDS = 90;
const HOUSEKEEPING_SECONDS = 20;
/** A 31 GB show takes a while to hand to ffmpeg. */
const MOUNT_SECONDS = 600;

/** The ffmpeg command: every piece is its own seeked input, so nothing between the pieces is decoded. */
export function pieceArgs(input: string, pieces: Piece[], output: string): string[] {
  const inputs = pieces.flatMap((p) => ["-ss", p.start.toFixed(3), "-t", p.seconds.toFixed(3), "-i", input]);
  const joined = pieces.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("") + `concat=n=${pieces.length}:v=1:a=1[v][a]`;
  return [
    "-hide_banner", "-y",
    ...inputs,
    "-filter_complex", joined,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart", output,
  ];
}

/** Re-encodes the pieces of `blob` into one MP4, in the order given. Cancelling stops ffmpeg at once. */
export async function cutPieces(blob: Blob, pieces: Piece[], o: CutPiecesOptions = {}): Promise<Blob> {
  const { signal, onProgress } = o;
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  if (!pieces.length) throw new Error("There is nothing to cut.");
  await ffmpegEngine.load(o.onStatus);
  if (signal?.aborted) throw cancelled();
  o.onStatus?.("Opening the video");
  const mounted = await withDeadline(ffmpegEngine.mountInputs([{ name: "recap_src.bin", blob }]), MOUNT_SECONDS * 1000, () => ffmpegEngine.stalled("opening the video"));
  const out = `/recap_${Date.now().toString(36)}.mp4`;
  const onAbort = () => ffmpegEngine.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  const total = pieces.reduce((sum, p) => sum + p.seconds, 0);
  try {
    if (signal?.aborted) throw cancelled();
    o.onStatus?.("Cutting the moments");
    const code = await ffmpegEngine.exec(
      pieceArgs(mounted.inputPath("recap_src.bin"), pieces, out),
      onProgress && ((t) => onProgress(Math.min(1, t / Math.max(0.001, total)))),
    );
    if (signal?.aborted) throw cancelled();
    if (code !== 0) throw new Error(`Could not cut the trailer.\n${ffmpegEngine.recentLogs()}`);
    const data = (await withDeadline(ffmpegEngine.instance.readFile(out), READ_SECONDS * 1000, () => ffmpegEngine.stalled("reading the finished cut"))) as Uint8Array;
    return new Blob([new Uint8Array(data)], { type: "video/mp4" });
  } catch (e) {
    // A cancel stops the engine, which surfaces as its own error; report the cancel instead.
    if (signal?.aborted) throw cancelled();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    const tidy = async () => {
      await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
      await mounted.release().catch(() => undefined);
    };
    await withDeadline(tidy(), HOUSEKEEPING_SECONDS * 1000, () => {
      ffmpegEngine.cancel();
      return new Error("cleanup stalled");
    }).catch(() => undefined);
  }
}
