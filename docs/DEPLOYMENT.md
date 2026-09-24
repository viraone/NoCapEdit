# Deployment and required headers

ReelFlow Web is a static site (`next build` writes `out/`). Every heavy job (ffmpeg,
Whisper, translation, diarization, TTS, storage) runs in the visitor's browser, so
any static host works and the owner pays nothing per user.

## Why COOP / COEP headers matter

The multi-threaded ffmpeg core (`@ffmpeg/core-mt`) uses WebAssembly threads, which
need `SharedArrayBuffer`. Browsers only expose `SharedArrayBuffer` on pages that are
**cross-origin isolated**, i.e. served with:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`Cross-Origin-Resource-Policy: cross-origin` is added so the site's own files can be
embedded by the service-worker fallback and by workers.

Without these headers the app still works: it detects `crossOriginIsolated === false`
and loads the single-threaded core (roughly 2–4× slower encodes). Whisper on WebGPU
does not need the headers; the WASM backend also benefits from threads when isolated.

### What `require-corp` means for third-party resources

Every cross-origin resource must either be fetched with CORS or carry a
`Cross-Origin-Resource-Policy` header. The app only loads these external resources,
all of which are CORS-enabled:

| Resource | Origin | Notes |
| --- | --- | --- |
| Whisper / Marian / pyannote / WeSpeaker / MMS-TTS models | `huggingface.co` (+ its CDN) | `fetch` with CORS, cached by the browser Cache API |
| ONNX Runtime Web wasm | `cdn.jsdelivr.net` | loaded by Transformers.js |
| ffmpeg core fallback | `unpkg.com` | only if `/ffmpeg/core*/ffmpeg-core.wasm` is missing on the host |
| Stock media (optional) | `api.pexels.com`, `pixabay.com` | user-supplied API key, CORS |

Everything else (fonts, ffmpeg cores, RNNoise model, workers) is served from the
site itself.

## Vercel

`vercel.json` (already in the repo):

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Resource-Policy", "value": "cross-origin" }
      ]
    }
  ]
}
```

Build command `npm run build`, output directory `out`.

## Netlify

`netlify.toml` (already in the repo) sets the same headers, or use `public/_headers`:

```
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Cross-Origin-Resource-Policy: cross-origin
```

## Cloudflare Pages

`public/_headers` is copied to `out/_headers` and applied automatically.
Cloudflare Pages caps single files at 25 MiB; the ffmpeg cores are ~32 MB, so on
Pages the app transparently falls back to loading the core from unpkg (see
`src/lib/ffmpeg/loader.ts`). To keep the cores first-party on Cloudflare, host
`public/ffmpeg/` on R2 and point `NEXT_PUBLIC_FFMPEG_BASE_URL`-style config at it, or
use a Worker.

## GitHub Pages / any host without header control

Headers cannot be configured, so the app registers `public/coi-sw.js`, a small
service worker that adds the COOP/COEP headers to every same-origin response and
reloads once. After that first reload `crossOriginIsolated` is `true`. Append
`?nocoi` to the URL to disable the service worker for debugging.

## nginx

```nginx
location / {
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Cross-Origin-Embedder-Policy "require-corp" always;
  add_header Cross-Origin-Resource-Policy "cross-origin" always;
  try_files $uri $uri/ $uri.html /404.html;
}
location ~* \.wasm$ { types { application/wasm wasm; } }
```

## Caddy

```
header {
  Cross-Origin-Opener-Policy "same-origin"
  Cross-Origin-Embedder-Policy "require-corp"
  Cross-Origin-Resource-Policy "cross-origin"
}
file_server
```

## Apache (.htaccess)

```
Header always set Cross-Origin-Opener-Policy "same-origin"
Header always set Cross-Origin-Embedder-Policy "require-corp"
Header always set Cross-Origin-Resource-Policy "cross-origin"
AddType application/wasm .wasm
```

## Local development

`next dev` does not send the headers; the service-worker fallback kicks in on
`http://localhost:3000` (service workers are allowed on localhost). For a production
check run `npm run build && npx serve out` and open the printed URL.

## Checklist

- [ ] `.wasm` served with `application/wasm` (needed for streaming compilation).
- [ ] COOP/COEP headers present (verify in DevTools → Application → Frames → Security
      & Isolation, or check `crossOriginIsolated` in the console).
- [ ] `/ffmpeg/core-mt/ffmpeg-core.wasm` returns 200 (else the CDN fallback is used).
- [ ] Storage: encourage users to allow persistent storage (the app requests it).
