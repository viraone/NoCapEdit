/**
 * Cuts several pieces out of one source video in a single ffmpeg run, either
 * joined into one file or each as its own. One run matters for a long show:
 * the desktop app copies the source into ffmpeg's folder once, not once per piece.
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

const ENCODE = [
  "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
  "-movflags", "+faststart",
];

/** One output file per piece, from the same seeked inputs. */
export function separateArgs(input: string, pieces: Piece[], outputs: string[]): string[] {
  const inputs = pieces.flatMap((p) => ["-ss", p.start.toFixed(3), "-t", p.seconds.toFixed(3), "-i", input]);
  return ["-hide_banner", "-y", ...inputs, ...outputs.flatMap((out, i) => ["-map", `${i}:v:0`, "-map", `${i}:a:0`, ...ENCODE, out])];
}

/** The ffmpeg command: every piece is its own seeked input, so nothing between the pieces is decoded. */
export function pieceArgs(input: string, pieces: Piece[], output: string): string[] {
  const inputs = pieces.flatMap((p) => ["-ss", p.start.toFixed(3), "-t", p.seconds.toFixed(3), "-i", input]);
  const joined = pieces.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("") + `concat=n=${pieces.length}:v=1:a=1[v][a]`;
  return [
    "-hide_banner", "-y",
    ...inputs,
    "-filter_complex", joined,
    "-map", "[v]", "-map", "[a]",
    ...ENCODE, output,
  ];
}

/** Re-encodes the pieces of `blob` into one MP4, in the order given. Cancelling stops ffmpeg at once. */
export async function cutPieces(blob: Blob, pieces: Piece[], o: CutPiecesOptions = {}): Promise<Blob> {
  const [out] = await run(blob, pieces, 1, (input, outputs) => pieceArgs(input, pieces, outputs[0]), o);
  return out;
}

/** Re-encodes each piece of `blob` into its own MP4, in the order given, still in one run. */
export async function cutEach(blob: Blob, pieces: Piece[], o: CutPiecesOptions = {}): Promise<Blob[]> {
  return run(blob, pieces, pieces.length, (input, outputs) => separateArgs(input, pieces, outputs), o);
}

async function run(blob: Blob, pieces: Piece[], files: number, args: (input: string, outputs: string[]) => string[], o: CutPiecesOptions): Promise<Blob[]> {
  const { signal, onProgress } = o;
  const cancelled = () => new DOMException("Cancelled", "AbortError");
  if (!pieces.length) throw new Error("There is nothing to cut.");
  await ffmpegEngine.load(o.onStatus);
  if (signal?.aborted) throw cancelled();
  o.onStatus?.("Opening the video");
  const mounted = await withDeadline(ffmpegEngine.mountInputs([{ name: "recap_src.bin", blob }]), MOUNT_SECONDS * 1000, () => ffmpegEngine.stalled("opening the video"));
  const stamp = Date.now().toString(36);
  // Bare names: the desktop shell only strips the leading slash from the last output, and a run may have several.
  const outputs = Array.from({ length: files }, (_, i) => `recap_${stamp}_${i}.mp4`);
  const onAbort = () => ffmpegEngine.cancel();
  signal?.addEventListener("abort", onAbort, { once: true });
  const total = pieces.reduce((sum, p) => sum + p.seconds, 0);
  try {
    if (signal?.aborted) throw cancelled();
    o.onStatus?.("Cutting the moments");
    const code = await ffmpegEngine.exec(
      args(mounted.inputPath("recap_src.bin"), outputs),
      // With several outputs ffmpeg reports the time of one of them: measure against the longest.
      onProgress && ((t) => onProgress(Math.min(1, t / Math.max(0.001, files > 1 ? Math.max(...pieces.map((p) => p.seconds)) : total)))),
    );
    if (signal?.aborted) throw cancelled();
    if (code !== 0) throw new Error(`Could not cut the trailer.\n${ffmpegEngine.recentLogs()}`);
    const blobs: Blob[] = [];
    for (const out of outputs) {
      const data = (await withDeadline(ffmpegEngine.instance.readFile(out), READ_SECONDS * 1000, () => ffmpegEngine.stalled("reading the finished cut"))) as Uint8Array;
      blobs.push(new Blob([new Uint8Array(data)], { type: "video/mp4" }));
    }
    return blobs;
  } catch (e) {
    // A cancel stops the engine, which surfaces as its own error; report the cancel instead.
    if (signal?.aborted) throw cancelled();
    throw e;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    const tidy = async () => {
      for (const out of outputs) await ffmpegEngine.instance.deleteFile(out).catch(() => undefined);
      await mounted.release().catch(() => undefined);
    };
    await withDeadline(tidy(), HOUSEKEEPING_SECONDS * 1000, () => {
      ffmpegEngine.cancel();
      return new Error("cleanup stalled");
    }).catch(() => undefined);
  }
}
