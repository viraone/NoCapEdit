/**
 * Seeks a <video> and resolves once a freshly decoded frame for that time is
 * actually presented, using requestVideoFrameCallback where available (the
 * `seeked` event can fire before the frame is painted). Resolves false when
 * the seek timed out, so callers can skip a sample instead of analysing a
 * stale frame.
 */
type VideoWithFrameCallback = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: () => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

export function seekFrame(video: HTMLVideoElement, time: number, timeoutMs = 1500): Promise<boolean> {
  const v = video as VideoWithFrameCallback;
  return new Promise((resolve) => {
    let done = false;
    let handle: number | null = null;
    const finish = (fresh: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener("seeked", onSeeked);
      if (handle !== null) v.cancelVideoFrameCallback?.(handle);
      resolve(fresh);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const hasFrameCallback = typeof v.requestVideoFrameCallback === "function";
    const onSeeked = () => {
      if (!hasFrameCallback) finish(video.readyState >= 2);
    };
    if (hasFrameCallback) handle = v.requestVideoFrameCallback!(() => finish(true));
    video.addEventListener("seeked", onSeeked);
    video.currentTime = time;
  });
}
