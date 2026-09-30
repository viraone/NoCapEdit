/**
 * Getting the finished MP4 *into the camera roll* on a phone. iOS has no
 * File System Access API and a plain download lands in Files, not Photos;
 * the Web Share API with a file is what shows the share sheet with
 * "Save Video". Must be called from a user gesture (a tap).
 */
export type SaveOutcome = "shared" | "downloaded";

export function canShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  try {
    const probe = new File([new Uint8Array(1)], "probe.mp4", { type: "video/mp4" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function saveVideo(blob: Blob, filename: string): Promise<SaveOutcome> {
  const file = new File([blob], filename, { type: "video/mp4" });
  if (canShareFiles()) {
    try {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    } catch (e) {
      // The user dismissed the sheet — nothing else to do.
      if (e instanceof DOMException && e.name === "AbortError") return "shared";
      // Any other failure: fall through to a download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "downloaded";
}

/** Keeps the screen on while we work, where the browser allows it. */
export async function acquireWakeLock(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => {
      lock?.release().catch(() => undefined);
    };
  } catch {
    return () => undefined;
  }
}
