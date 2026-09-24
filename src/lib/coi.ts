/**
 * Multi-threaded ffmpeg.wasm needs SharedArrayBuffer, which browsers only
 * expose on cross-origin isolated pages (COOP/COEP headers). Static hosts that
 * cannot set headers get the same effect from a tiny service worker that adds
 * them to every response. Skip with ?nocoi in the URL.
 */
import { BASE_PATH } from "@/lib/basePath";

export function ensureCrossOriginIsolation(): void {
  if (typeof window === "undefined") return;
  if (window.crossOriginIsolated) return;
  if (!("serviceWorker" in navigator)) return;
  if (new URLSearchParams(location.search).has("nocoi")) return;
  if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  const key = "reelflow-coi-reload";
  if (sessionStorage.getItem(key)) return;

  navigator.serviceWorker
    .register(`${BASE_PATH}/coi-sw.js`, { scope: `${BASE_PATH}/` })
    .then((registration) => {
      const reload = () => {
        sessionStorage.setItem(key, "1");
        location.reload();
      };
      if (registration.active && !navigator.serviceWorker.controller) {
        reload();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", reload, { once: true });
    })
    .catch(() => {
      /* Isolation is optional: the app falls back to the single-thread core. */
    });
}
