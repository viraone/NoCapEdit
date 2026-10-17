/**
 * Browsers slow <video> work right down in a tab that is not in front, so a
 * frame-by-frame job there crawls (each seek waits out its fallback). Rather
 * than pay for that, a job waits here while the tab is hidden and carries on
 * the moment it is back in front. `onChange` lets the caller say so on screen.
 */
export function whenVisible(onChange?: (hidden: boolean) => void): Promise<void> {
  if (typeof document === "undefined" || !document.hidden) return Promise.resolve();
  onChange?.(true);
  return new Promise((resolve) => {
    const check = () => {
      if (document.hidden) return;
      document.removeEventListener("visibilitychange", check);
      onChange?.(false);
      resolve();
    };
    document.addEventListener("visibilitychange", check);
  });
}
