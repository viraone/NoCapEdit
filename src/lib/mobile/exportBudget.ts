/**
 * How big an export will be, and whether it should stream to Blob storage
 * instead of building the whole MP4 in the JS heap.
 *
 * Both mobile exporters size their H.264 bitrate the same way — 0.1 bits per
 * pixel per second, clamped to 2.5–12 Mbps — so the editor can use the same
 * estimate to pick the streaming path before a frame is encoded. Pure, with no
 * browser APIs, so tests can run it in Node.
 */

export const MIN_VIDEO_BITRATE = 2_500_000;
export const MAX_VIDEO_BITRATE = 12_000_000;
/** AAC-LC, the rate exportLite muxes the audio at. */
export const AUDIO_BITRATE = 128_000;
/** Estimated output size above which streaming into Blob storage is worth it. */
export const STREAMING_THRESHOLD_BYTES = 64 * 1024 * 1024;

/** The bitrate exportLite and fastExport configure the video encoder with. */
export function estimatedVideoBitrate(width: number, height: number, fps = 30): number {
  return Math.min(MAX_VIDEO_BITRATE, Math.max(MIN_VIDEO_BITRATE, Math.round(width * height * fps * 0.1)));
}

/**
 * Whether a clip of this length and output size is likely to produce an MP4
 * over about 64 MB. Short exports stay on the in-memory path, which is the
 * fast-start file iOS and the desktop both import without fuss.
 */
export function shouldStream(durationSec: number, width: number, height: number, bitrate?: number): boolean {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return false;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false;
  const videoBits = bitrate !== undefined && Number.isFinite(bitrate) && bitrate > 0 ? bitrate : estimatedVideoBitrate(width, height);
  return ((videoBits + AUDIO_BITRATE) / 8) * durationSec > STREAMING_THRESHOLD_BYTES;
}
