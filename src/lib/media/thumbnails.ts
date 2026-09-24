import type { ThumbsRecord } from "@/lib/storage/db";

const MAX_SPRITE_WIDTH = 8000;

function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.onseeked = null;
      resolve();
    };
    video.onseeked = finish;
    setTimeout(finish, 1500);
    video.currentTime = time;
  });
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.onloadeddata = () => resolve(video);
    video.onerror = () => reject(new Error("Could not load video for thumbnails"));
    video.src = url;
  });
}

/**
 * Builds a horizontal JPEG sprite of evenly spaced frames from a video Blob.
 * Runs entirely in the browser using a hidden <video> and a canvas.
 */
export async function generateFilmstrip(
  assetId: string,
  blob: Blob,
  duration: number,
  frameHeight = 72,
  maxFrames = 120,
): Promise<ThumbsRecord> {
  const url = URL.createObjectURL(blob);
  try {
    const video = await loadVideo(url);
    const aspect = video.videoWidth / Math.max(1, video.videoHeight) || 9 / 16;
    const frameWidth = Math.max(16, Math.round(frameHeight * aspect));
    const byWidth = Math.floor(MAX_SPRITE_WIDTH / frameWidth);
    const byDuration = Math.max(1, Math.ceil(duration / 0.5));
    const count = Math.max(1, Math.min(maxFrames, byWidth, byDuration));
    const canvas = document.createElement("canvas");
    canvas.width = frameWidth * count;
    canvas.height = frameHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const interval = duration / count;
    for (let i = 0; i < count; i++) {
      const t = Math.min(Math.max(0, duration - 0.05), (i + 0.5) * interval);
      await seek(video, t);
      try {
        ctx.drawImage(video, i * frameWidth, 0, frameWidth, frameHeight);
      } catch {
        // Ignore frames the browser refuses to paint.
      }
    }
    video.removeAttribute("src");
    video.load();
    const sprite = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.72),
    );
    return { assetId, sprite, count, frameWidth, frameHeight, duration };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Captures one frame as a small JPEG, used for project cards. */
export async function captureFrame(blob: Blob, time: number, maxWidth = 360): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const video = await loadVideo(url);
    await seek(video, time);
    const scale = Math.min(1, maxWidth / Math.max(1, video.videoWidth));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.removeAttribute("src");
    video.load();
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.8),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
