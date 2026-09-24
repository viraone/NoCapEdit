# NoCap Edit — developer handoff

_Last updated 2026-09-24. Production: https://nocapedit.com · Repo: https://github.com/viraone/NoCapEdit_

## 1. What this is

NoCap Edit (originally built under the working name "ReelFlow Web") is a browser-native
video editor for solo creators: drop a recording, get a captioned, platform-shaped
vertical clip (Reels / TikTok / Shorts). The defining constraint is **zero recurring
cost for the owner**: it is a static site, and every heavy job runs in the visitor's
browser with WebAssembly / WebGL / WebGPU:

- video decode, compositing and H.264/H.265 encode (ffmpeg.wasm in a Web Worker)
- speech-to-text with word timings (Whisper via Transformers.js, WebGPU or WASM)
- speaker diarization, translation, text-to-speech (Transformers.js models)
- noise removal (ffmpeg `arnndn` / `afftdn`), face detection for auto-reframe (MediaPipe)
- all persistence in IndexedDB (project JSON + media Blobs)

There is no backend, no database and no API keys owned by the project. The only
external services are model downloads from the Hugging Face Hub and, optionally, the
user's own Pexels/Pixabay key for stock footage.

## 2. Running it

```bash
npm install          # Node 20+ locally (CI uses 22)
npm run dev          # copies ffmpeg cores into public/, starts next dev on :3000
npm run build        # static export to out/
npm run test         # vitest: 47 unit tests incl. a native-ffmpeg parity test
npm run typecheck
npm run lint         # eslint (Next config)
npm run test:e2e     # Playwright smoke test against out/ (build first)
E2E_URL=https://nocapedit.com/ node e2e/smoke.mjs   # same test against production
node e2e/screenshot.mjs                              # start + editor screenshots
```

`scripts/copy-ffmpeg.mjs` runs before dev/build: it copies `@ffmpeg/ffmpeg`'s class
worker, both ffmpeg cores (single- and multi-threaded, 32 MB each) and the MediaPipe
wasm runtime into `public/` (git-ignored). The RNNoise model `public/models/sh.rnnn`
is committed.

## 3. Deployment

GitHub Pages via `.github/workflows/pages.yml` on every push to `main`: `npm install`
(not `npm ci`; the macOS lock file lacks Linux optional packages), typecheck, tests,
`next build`, upload `out/`, deploy. Custom domain `nocapedit.com` comes from
`public/CNAME`; HTTPS is enforced in the Pages settings. Build takes ~3 minutes.

Pages cannot send the COOP/COEP headers that `SharedArrayBuffer` (multi-threaded
ffmpeg) needs, so `public/coi-sw.js` is a service worker that adds them and reloads
once. `docs/DEPLOYMENT.md` has header configs for Vercel, Netlify, Cloudflare, nginx,
Caddy and Apache if the host ever changes. `NEXT_PUBLIC_BASE_PATH` exists only for
sub-path hosting and must stay unset for production.

## 4. Stack

Next.js 16 (App Router, `output: "export"`, Turbopack), React 19, TypeScript,
Tailwind 4, Zustand, `idb`, `@ffmpeg/ffmpeg` 0.12 + `@ffmpeg/core(-mt)` 0.12.10,
`@huggingface/transformers` 4 (successor of `@xenova/transformers`; same API plus
WebGPU), `@mediapipe/tasks-vision`, lucide-react, vitest, Playwright.

## 5. Code map

```
src/app/                    routes: / (start screen), /editor?id= (editor)
src/components/
  start/StartScreen.tsx     project manager (IndexedDB), quick import, new-project dialog
  editor/EditorShell.tsx    layout, keyboard shortcuts, engine wiring, notice strip
  editor/TopBar.tsx         name, Home|Edit control, Import clips, Export video
  panels/ToolRail.tsx       8 tools: Clips, Trim, Subtitles, Style, Text, Picture, Music, Export
  panels/*Panel.tsx         one inspector per tool (+ TrackControls, StockSection, useImportClips)
  canvas/VideoCanvas.tsx    preview interaction: drag, snapping, resize, double-click, pan
  CanvasRenderer.tsx        compositing surface (rAF loop) + re-exports captureFrames
  canvas/CanvasBar.tsx      pill row: format, picture zoom, Fill/Fit, caption style, safe zone
  canvas/TransportBar.tsx   play/cut buttons, timecode, Earlier/Later/Remove
  timeline/TimelineDock.tsx ruler, caption lane, clip strip (Filmstrip + AudioWaveform), music lane
  ui/                       Button, Tile, Panel, Field, Select, Toggle, Slider, ColorInput, Modal…
src/lib/
  models/project.ts         VideoProject schema, factories, normalizeProject (migrations), keyframe helpers
  models/timeline.ts        layout math: clip starts/ends with transition overlap, time mapping
  models/placement.ts       cover-fit + zoom + pan → where the source lands in the frame
  models/clipOps.ts         split, cut before/after, move, duplicate, fitZoom
  models/formats.ts         20 frame formats + safe-zone masks
  playback/engine.ts        preview engine: one <video> per clip, replacement audio, voice-overs, music
  playback/draw.ts          video layer incl. native transition drawing
  playback/compositor.ts    Compositor (video + GLSL transitions + overlays + captions), captureFrames
  captions/renderer.ts      canvas caption/overlay renderer shared by preview and export
  captions/presets.ts       18 caption styles; fonts.ts font registry; srt.ts SRT/TXT
  speech/captionBuilder.ts  word → cue grouping rules
  speech/ml.worker.ts       Transformers.js worker: Whisper, Marian, pyannote+WeSpeaker, MMS-TTS
  speech/mlClient.ts        request/response plumbing, cancellation
  speech/transcriber.ts     Whisper wrapper, model list, timing mapping
  speech/translator.ts      browser Translation API → Marian fallback; languages.ts routes
  speech/webSpeech.ts       Web Speech API dictation fallback; tts.ts voice-overs
  transcriptionEngine.ts    transcription + diarization + WebVTT/SRT (spec deliverable)
  ffmpegEngine.ts           FFmpeg wrapper: probe, encoder flags, HDR chain, segmented render + splice (spec deliverable)
  ffmpeg/loader.ts          core loading (local → unpkg fallback), debug flags
  ffmpeg/filters.ts         pure filter-graph / arg builders (unit-tested)
  ffmpeg/segments.ts        cuts the timeline into render segments (never inside a transition)
  ffmpeg/mp4.ts             fMP4 box utils: strip init, renumber, shift tfdt
  ffmpeg/sinks.ts           Blob sink and File System Access disk sink
  ffmpeg/exporter.ts        project → RenderJob orchestration, sidecars
  ffmpeg/waveform.ts        Web Audio decode (16 kHz mono) + peaks
  gl/transitions.ts         WebGL2 GLSL transition engine (10 shaders)
  tracking/templateTracker.ts  NCC motion tracker; autoReframe.ts MediaPipe face → pan keyframes
  audio/enhance.ts          RNNoise / spectral denoise via ffmpeg → replacement WAV
  stock/providers.ts        Pexels / Pixabay search + download
  storage/db.ts             IndexedDB stores: projects, assets, peaks, thumbs, projectThumbs
  media/                    import flows, probing, filmstrip thumbnails, asset events
  basePath.ts, coi.ts       sub-path support, cross-origin isolation service worker
src/store/editorStore.ts    Zustand: project + undo/redo (transactions for drags), selection, time, notice
e2e/                        smoke.mjs (full flow + ffprobe validation), screenshot.mjs, serve.mjs, fixtures/
docs/                       DEPLOYMENT.md, EXPORT-PIPELINE.md (read this), ROADMAP.md, this file
```

## 6. Data model in one paragraph

`VideoProject` (`src/lib/models/project.ts`) holds `clips` (asset id, in/out, speed,
pitch mode, zoom, pan, background colour, transition, optional replacement audio and
auto-reframe keyframes), `cues` (start/end, text, translation, word timings, detached
anchor, speaker), `overlays` (text titles/banners and image stickers with timing,
position, opacity, rotation, optional motion track), `voiceovers`, `music`,
`subtitleStyle`, `captions` settings, `safeZone`, `formatId`. Media lives as Blobs in
the `assets` store keyed by asset id; `normalizeProject()` fills defaults for older
records, so add new fields there. Project objects are immutable: `store.update(fn)`
clones, mutates the draft and saves (debounced) to IndexedDB.

## 7. How the pipelines work

**Preview.** `PlaybackEngine` keeps a hidden `<video>` per clip and derives project time
from the primary clip's `currentTime` (transition overlaps play two clips).
`CanvasRenderer` runs a rAF loop: `Compositor.composite()` draws the video layer
(native or GLSL transition), then overlays and captions through the same renderer the
export uses, and returns element rectangles for hit-testing.

**Captions.** Audio is decoded once to 16 kHz mono (`getSpeechAudio`), sliced to the
clip's in/out, sent to the ML worker. Whisper returns word timestamps which are mapped
to project time and grouped by `buildCues()` (max 4 words, 2.4 s, 0.6 s pause ends a
cue, 0.25 s tail, 0.5 s minimum). With "Identify speakers" on, pyannote segmentation
+ WeSpeaker embeddings are clustered and cues never cross a speaker change.

**Export.** `exporter.ts` splits the timeline into ~20 s segments, decides per segment
between the ffmpeg filter graph (cuts, xfade, static overlays as a PNG concat stream,
HDR tone-map, music/voice-over mix) and the canvas compositor (GPU transitions,
tracked overlays, reframed clips → JPEG frame sequence), encodes each as a fragmented
MP4 and splices them while streaming to a Blob or a File System Access writable.
`docs/EXPORT-PIPELINE.md` documents every non-obvious flag; do not remove any of them
without re-running `npm test` (native parity) and the e2e.

## 8. Hard-won gotchas (keep these)

- **Threaded ffmpeg core dies on any non-zero exit** (`Aborted()` then the next exec
  hangs). Probe with `-i f -frames:v 1 -frames:a 1 -f null -`; `FFmpegEngine.exec`
  recycles the worker on failure; a 40 s log-silence watchdog throws `FFmpegHungError`
  and the exporter restarts single-threaded (`preferSingleThread`).
- **`Aborted()` at the end of every command is normal** for this core build.
- **fMP4 splicing:** the muxer zeroes fragment `tfdt` regardless of `-output_ts_offset`
  or `setpts`; offsets are patched into `tfdt` at splice time (`mp4.ts`). Segmented
  renders use `-bf 0`, a final `fps=` filter, `-avoid_negative_ts disabled`, and trim
  one AAC frame (1024 samples) from every non-final segment's audio so the next
  segment's priming frame fits without overlap or drift.
- **`-t` is absolute** on output timestamps; the graph's `trim`/`atrim` bound segments.
- **Inputs are mounted with WORKERFS** (no copy into the wasm heap). Outputs are read
  and deleted per segment.
- **SSR stub:** `@ffmpeg/ffmpeg` resolves to an empty module on the server; import only
  types (`import type { FFFSType }`) and use string literals for enums.
- **`public/*.d.ts` must not exist** (tsconfig excludes `public/`; the copy script
  filters `.d.ts`), or the webworker lib leaks into the type program.
- **Fonts:** next/font downloads at build time; canvas uses `fontFamily(key)` from the
  registry, and `ensureFontsLoaded()` runs before export.
- **Cloudflare Pages** caps files at 25 MiB; the loader falls back to unpkg for the cores.

## 9. Feature status

| Area | Status |
| --- | --- |
| Import, timeline, trim/speed/zoom/pan, transitions, text/stickers, music, undo, autosave | Done, exercised by the e2e |
| Whisper captions (WASM), caption builder, 18 styles, SRT/TXT/VTT | Done, e2e-verified (WebGPU path not exercised headless) |
| Export: filter path, segmented streaming, splice, sidecars | Done, e2e + native parity verified |
| Export: compositor path (GPU transitions, tracked overlays, reframe) | Implemented, not covered by automated tests |
| 4K/60 fps, bitrate control, H.265, HDR tone-map, disk streaming | Implemented; HDR and disk sink untested with real files |
| Translation (browser API / Marian), speaker diarization, TTS voice-overs | Implemented, wrapped in graceful failure; not runtime-tested |
| Noise removal, motion tracking, auto-reframe, stock search | Implemented; not runtime-tested end to end |
| Eye-contact correction, stem separation, 10-bit output | Not implemented (see `docs/ROADMAP.md`) |

## 10. UI / design system

The editor was restyled to match the owner's earlier macOS app ("Halycol"): Apple
system dark colours as `--color-sys-*` tokens in `src/app/globals.css`, monospace UI
type, `.card` / `.tile` / `.pill` / `.caps` classes, per-tool colours on the rail,
Home|Edit control with "Import clips" / "Export video", notice strip, tile-based
inspector sections. New panels should reuse `Tile`, `PanelSection`, `Button`, `Field`
and the pill styles. Caption typography is separate (18 presets, `captions/presets.ts`).

## 11. Debugging

`localStorage.setItem("reelflow.debug","1")` mirrors ffmpeg logs to the console;
`reelflow.singleThread=1` forces the single-threaded core; `?nocoi` disables the
isolation service worker. `e2e/results/` holds screenshots and exports from test runs.
Internal names (`reelflow` IndexedDB, `reelflow.*` keys, `.rf-*` CSS) intentionally
kept the old product name so users' local projects survive the rename.

## 12. Suggested next steps

1. Run the stretch features against real footage (diarization, TTS, reframe, noise
   removal, disk streaming) and fix API drift in the ML worker if any.
2. Add a loading/first-run explainer for model downloads (tiny 45 MB → large 600 MB).
3. Persist export settings and last-used models per user.
4. Consider a `CLAUDE.md`/CONTRIBUTING with the commands above.
5. Re-check the ffmpeg.wasm threaded core in current desktop Chrome; if it works
   reliably there, the watchdog fallback only matters for edge environments.

## 13. Timeline of the work (for context)

1. Scaffolded Next.js static export; data model, IndexedDB, timeline math, caption
   renderer, caption builder, playback engine, all eight panels, start screen.
2. Whisper/translation worker, ffmpeg export with overlay PNG layer, SRT/TXT.
3. Second spec: `ffmpegEngine`, `transcriptionEngine`, `CanvasRenderer`, header docs;
   GLSL transitions, segmented disk streaming, HDR, speaker ID, TTS, motion tracking,
   auto-reframe, noise removal, stock search.
4. Playwright e2e found and fixed: threaded-core abort on probe, watchdog fallback,
   fragment timestamp splicing, seam timing (B-frames, AAC priming, first-frame policy).
5. Pushed to GitHub, GitHub Pages workflow, custom domain, HTTPS.
6. Restyled to the Halycol design; renamed to NoCap Edit.
