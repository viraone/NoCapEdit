/**
 * The size a clip is meant to be shown at, read from the file: the coded
 * size with the track's rotation applied (a phone clip stored sideways
 * with a 90° flag is still a landscape clip). The exporter uses the same
 * numbers, so the preview's crop maths can't disagree with the export.
 *
 * Why not <video>.videoWidth: iPhone Safari has reported some rotated
 * clips by their stored size (1080×1920 for a 1920×1080 clip), which made
 * Original a tall box and a 9:16 frame immovable.
 */
export async function readDisplaySize(file: Blob): Promise<{ w: number; h: number } | null> {
  try {
    const mb = await import("mediabunny");
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track || !track.displayWidth || !track.displayHeight) return null;
      return { w: track.displayWidth, h: track.displayHeight };
    } finally {
      input.dispose();
    }
  } catch {
    return null;
  }
}
