export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

/**
 * A busy computer can take a long while to decode a video's header (a 20 s limit
 * failed a good 3.6 MB reel on a Mac under heavy load), so the limit is generous and
 * the message says what to do.
 */
const PROBE_TIMEOUT_MS = 60_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} took too long. Your computer may be busy; try again in a moment.`)), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });
}

/** Reads duration and dimensions of a video Blob using a hidden <video>. */
export async function probeVideo(blob: Blob): Promise<VideoInfo> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    const info = await withTimeout(
      new Promise<VideoInfo>((resolve, reject) => {
        video.onerror = () => reject(new Error("This file could not be decoded by your browser."));
        video.onloadedmetadata = async () => {
          let duration = video.duration;
          if (!Number.isFinite(duration) || duration === 0) {
            // WebM recordings from MediaRecorder report Infinity until seeked.
            duration = await new Promise<number>((res) => {
              video.currentTime = 1e6;
              video.ontimeupdate = () => {
                video.ontimeupdate = null;
                res(video.duration);
                video.currentTime = 0;
              };
            });
          }
          resolve({ duration, width: video.videoWidth, height: video.videoHeight });
        };
        video.src = url;
      }),
      PROBE_TIMEOUT_MS,
      "Reading the video",
    );
    if (!info.width || !info.height) throw new Error("No video track found in this file.");
    return info;
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

export async function probeAudio(blob: Blob): Promise<{ duration: number }> {
  const url = URL.createObjectURL(blob);
  const audio = document.createElement("audio");
  audio.preload = "metadata";
  try {
    return await withTimeout(
      new Promise<{ duration: number }>((resolve, reject) => {
        audio.onerror = () => reject(new Error("This audio file could not be decoded by your browser."));
        audio.onloadedmetadata = () => resolve({ duration: audio.duration });
        audio.src = url;
      }),
      PROBE_TIMEOUT_MS,
      "Reading the audio",
    );
  } finally {
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
  }
}

export async function probeImage(blob: Blob): Promise<{ width: number; height: number }> {
  if ("createImageBitmap" in window) {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  }
  const url = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error("Unsupported image"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
