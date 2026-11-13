/** What an import can learn about a clip's sound, and how it decides when decoding comes back empty. */
import type { AudioStatus } from "@/lib/models/project";

export interface AudioReadOutcome {
  /** A picture made into a silent video: there is no sound to read. */
  still?: boolean;
  /** The file was too large to decode, so the import keeps assuming it has sound. */
  skipped?: boolean;
  /** decodeAudio returned samples. */
  decoded?: boolean;
  /** What the container declares: true for an audio track, false for none, null when it could not be read. */
  containerHasAudio?: boolean | null;
}

/**
 * The verdict to record for a clip's sound. A decode that returns nothing could be a
 * silent file or an audio track the browser cannot read, so the container decides.
 * When the container cannot be read either, the old quiet answer ("none") wins: it is
 * better than claiming a failure the file may not have.
 */
export function audioStatusFor(o: AudioReadOutcome): AudioStatus {
  if (o.still) return "none";
  if (o.skipped || o.decoded) return "ok";
  return o.containerHasAudio === true ? "failed" : "none";
}

/** What the container says about a file's audio, read from its headers without decoding a sample. */
export type AudioTrackProbe = { kind: "track"; codec: string | null } | { kind: "none" } | { kind: "unknown" };

/**
 * Looks for an audio track in the container with mediabunny (already used for the same
 * job on the phone path). Only headers are read and it loads lazily, so the cost appears
 * only when AudioContext could not decode the file. "unknown" means the file could not be
 * read at all; callers keep the answer they would have given before.
 */
export async function findAudioTrack(file: Blob): Promise<AudioTrackProbe> {
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const [track] = await input.getAudioTracks();
      return track ? { kind: "track", codec: track.codec } : { kind: "none" };
    } finally {
      input.dispose();
    }
  } catch {
    return { kind: "unknown" };
  }
}
