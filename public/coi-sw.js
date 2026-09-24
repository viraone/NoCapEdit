/* Service worker that adds cross-origin isolation headers to same-origin
 * responses so SharedArrayBuffer (multi-threaded ffmpeg.wasm) works on hosts
 * that cannot set COOP/COEP headers themselves. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  if (!sameOrigin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.status === 0 || response.type === "opaque") return response;
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Embedder-Policy", "require-corp");
        headers.set("Cross-Origin-Opener-Policy", "same-origin");
        headers.set("Cross-Origin-Resource-Policy", "cross-origin");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      })
      .catch((error) => {
        throw error;
      }),
  );
});
