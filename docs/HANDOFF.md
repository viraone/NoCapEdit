# NoCap Edit — developer handoff

_Last updated 2026-09-24 (commit `da7cde1`). Production: https://nocapedit.com · Repo: https://github.com/viraone/NoCapEdit_

## 1. What this is

NoCap Edit (built under the working name "ReelFlow Web") is a browser-native video
editor for solo creators: drop a recording, get a captioned, platform-shaped vertical
clip (Reels / TikTok / Shorts). The defining constraint is **zero recurring cost for
the owner**: it is a static site, and every heavy job runs in the visitor's browser
with WebAssembly / WebGL / WebGPU:

- video decode, compositing and H.264/H.265 encode (ffmpeg.wasm in a Web Worker)
- speech-to-text with word timings (Whisper via Transformers.js, WebGPU or WASM)
- speaker diarization, translation, text-to-speech, background removal
  (Transformers.js models: pyannote + WeSpeaker, Marian, MMS-TTS, RMBG-1.4)
- noise removal and audio presets (ffmpeg `arnndn`/`afftdn`/`acompressor`/`loudnorm`),
  face detection for auto-reframe (MediaPipe), colour grading (WebGL + `lut3d`/`eq`)
- all persistence in IndexedDB (project JSON + media Blobs), plus `.nocap` backups

There is no backend, no database and no API keys owned by the project. The only
external services are model downloads from the Hugging Face Hub (cached by the
browser), the MediaPipe face model from Google's public bucket, and, optionally, the
user's own Pexels/Pixabay key for stock footage.

## 2. Running it

```bash
npm install          # Node 20+ locally (CI uses 22)
npm run dev          # copies runtimes into public/, starts next dev on :3000
npm run build        # static export to out/
npm run test         # vitest: 54 unit tests incl. a native-ffmpeg splice parity test
npm run typecheck
npm run lint         # eslint (Next config + React Compiler rules)
npm run test:e2e     # Playwright smoke test against out/ (build first)
E2E_URL=https://nocapedit.com/ node e2e/smoke.mjs   # same test against production
node e2e/screenshot.mjs                              # start + editor screenshots
```

`scripts/copy-ffmpeg.mjs` runs before dev/build and copies into `public/` (all
git-ignored): the `@ffmpeg/ffmpeg` class worker, both ffmpeg cores (single- and
multi-threaded, 32 MB each), the MediaPipe vision wasm, and the dotLottie player wasm.
Committed runtime assets: `public/models/sh.rnnn` (RNNoise), `public/sfx/*.mp3`
(synthesised sound effects), `public/coi-sw.js`, `public/CNAME`, `public/.nojekyll`.

## 3. Deployment

GitHub Pages via `.github/workflows/pages.yml` on every push to `main`: `npm install`
(not `npm ci`; the macOS lock file lacks Linux optional packages), typecheck, tests,
`next build`, upload `out/`, deploy. About three minutes. The custom domain
`nocapedit.com` comes from `public/CNAME`; HTTPS is enforced in the Pages settings.
The old project URL (`viraone.github.io/NoCapEdit`) redirects.

Pages cannot send the COOP/COEP headers that `SharedArrayBuffer` (multi-threaded
ffmpeg) needs, so `public/coi-sw.js` is a service worker that adds them and reloads
once. `docs/DEPLOYMENT.md` has header configs for Vercel, Netlify, Cloudflare, nginx,
Caddy and Apache if the host ever changes. `NEXT_PUBLIC_BASE_PATH` exists only for
sub-path hosting and must stay unset for production.

## 4. Stack

Next.js 16 (App Router, `output: "export"`, Turbopack), React 19, TypeScript,
Tailwind 4, Zustand, `idb`, `@ffmpeg/ffmpeg` 0.12 + `@ffmpeg/core(-mt)` 0.12.10,
`@huggingface/transformers` 4 (successor of `@xenova/transformers`; same API plus
WebGPU), `@mediapipe/tasks-vision`, `@lottiefiles/dotlottie-web`, `fflate`,
lucide-react, vitest, Playwright.

## 5. Code map

```
src/app/                      routes: / (start screen), /editor?id= (editor)
src/components/
  start/StartScreen.tsx       project manager, quick import, Record, Import backup / Backup
  record/Recorder.tsx         screen / camera / screen+mic MediaRecorder modal
  editor/EditorShell.tsx      floating-card layout, keyboard shortcuts, engine wiring, notice strip
  editor/TopBar.tsx           name, Home|Edit control, Import clips, Export video
  panels/ToolRail.tsx         8 tools: Clips, Trim, Subtitles, Style, Text, Picture, Music, Export
  panels/ClipsPanel.tsx       import, record, sequence, stock footage, cleanup
  panels/TrimPanel.tsx        cut at playhead, Magic Cut, speed, transitions, picture zoom,
                              sound presets, colour + LUT + scopes, background, more options
                              (in/out, pitch, pan, noise removal, subject cut-out, auto-reframe)
  panels/SubtitlesPanel.tsx   Whisper, words-per-caption, speakers, highlights, translate, cue list
  panels/StylePanel.tsx       20 presets, size/position, highlight, emoji, speaker colours
  panels/TextPanel.tsx        titles/banners, entrance animations, layer, motion tracking
  panels/PicturePanel.tsx     stickers, Lottie animations, remove background, layer, tracking
  panels/MusicPanel.tsx       music track, sound effects, TTS voice-overs
  panels/ExportPanel.tsx      resolution/fps/codec/rate control/HDR, layers, delivery
  panels/Scopes.tsx, TrackControls.tsx, StockSection.tsx, useImportClips.ts
  canvas/VideoCanvas.tsx      preview interaction: drag, snapping, resize, double-click, pan
  CanvasRenderer.tsx          compositing surface (rAF loop), exposes the preview canvas
  canvas/CanvasBar.tsx        pill row: format, picture zoom, Fill/Fit, caption style, safe zone
  canvas/TransportBar.tsx     play / cut buttons, timecode, Earlier / Later / Remove
  timeline/TimelineDock.tsx   ruler, caption lane + prompt, clip strip, hover preview, music/sfx lane
  ui/                         Button, Tile, Panel, Field, Select, Toggle, Slider, ColorInput, Modal…
src/lib/
  models/project.ts           VideoProject schema, factories, normalizeProject (migrations), keyframes
  models/timeline.ts          layout math: clip starts/ends with transition overlap, time mapping
  models/placement.ts         cover-fit + zoom + pan → where the source lands in the frame
  models/clipOps.ts           split, cut before/after, move, duplicate, fitZoom
  models/formats.ts           20 frame formats + safe-zone masks
  playback/engine.ts          preview engine: <video> per clip, replacement audio, voice-overs,
                              music, Web Audio preset chains
  playback/draw.ts            video layer: transitions, colour grading, matte masks, backgrounds
  playback/compositor.ts      Compositor (behind layer + video + overlays + captions), captureFrames
  captions/renderer.ts        caption/overlay renderer (word animation, emoji, text entrances, Lottie)
  captions/presets.ts         20 caption styles; emoji.ts keyword map; fonts.ts registry; srt.ts
  speech/captionBuilder.ts    word → cue grouping rules
  speech/ml.worker.ts         Transformers.js worker: Whisper, Marian, pyannote+WeSpeaker, MMS-TTS, RMBG
  speech/mlClient.ts          request/response plumbing, cancellation
  speech/transcriber.ts, translator.ts, webSpeech.ts, tts.ts, languages.ts
  transcriptionEngine.ts      transcription + diarization + WebVTT/SRT (spec deliverable)
  ffmpegEngine.ts             FFmpeg wrapper: probe, encoder flags, HDR chain, segmented render + splice,
                              hang watchdog (spec deliverable)
  ffmpeg/loader.ts            core loading (local → unpkg fallback), debug flags
  ffmpeg/filters.ts           pure filter-graph / arg builders (unit-tested)
  ffmpeg/segments.ts          cuts the timeline into render segments (never inside a transition)
  ffmpeg/mp4.ts               fMP4 box utils: strip init, renumber, shift tfdt
  ffmpeg/sinks.ts             Blob sink and File System Access disk sink (reset for restarts)
  ffmpeg/exporter.ts          project → RenderJob orchestration, LUT files, sidecars
  ffmpeg/waveform.ts          Web Audio decode (16 kHz mono) + peaks
  edit/magicCut.ts            filler-word / dead-air detection, range removal with re-timing
  edit/highlights.ts          TF-IDF + delivery-cue highlight finder
  audio/enhance.ts            RNNoise / spectral denoise via ffmpeg → replacement WAV
  audio/fx.ts, audio/sfx.ts   audio presets (Web Audio + ffmpeg halves), sound-effect library
  color/cube.ts, gl/colorGrade.ts   .cube LUT parser + WebGL grader (mirrors lut3d + eq)
  gl/transitions.ts           WebGL2 GLSL transition engine (10 shaders)
  lottie/registry.ts          dotLottie instances rendered per frame for overlays and export
  matte/matte.ts              RMBG background removal for stickers; offline video matting masks
  tracking/templateTracker.ts NCC motion tracker; autoReframe.ts MediaPipe face → pan keyframes
  stock/providers.ts          Pexels / Pixabay search + download
  storage/db.ts               IndexedDB stores: projects, assets, peaks, thumbs, projectThumbs
  storage/backup.ts           .nocap streamed zip export / import (fflate)
  media/                      import flows, probing, filmstrip thumbnails, asset events
  basePath.ts, coi.ts         sub-path support, cross-origin isolation service worker
src/store/editorStore.ts      Zustand: project + undo/redo (transactions for drags), selection, time, notice
e2e/                          smoke.mjs (full flow + ffprobe validation), screenshot.mjs, serve.mjs, fixtures/
docs/                         DEPLOYMENT.md, EXPORT-PIPELINE.md (read this), ROADMAP.md, this file
```

## 6. Data model in one paragraph

`VideoProject` (`src/lib/models/project.ts`) holds `clips` (asset id, in/out, speed,
pitch mode, zoom, pan, background colour, transition, replacement audio, audio preset,
colour `look`, `matte` masks, `reframe` keyframes), `cues` (start/end, text, translation,
word timings, detached anchor, speaker), `overlays` (text with entrance animation, image
stickers, Lottie animations; each with timing, position, opacity, rotation, optional
motion track and `layer` front/behind), `voiceovers` (TTS clips and sound effects,
`kind`), `music`, `subtitleStyle` (preset, size, position, highlight, emoji, speaker
colours), `captions` settings, `safeZone`, `formatId`. Media lives as Blobs in the
`assets` store keyed by asset id; `normalizeProject()` fills defaults for older
records, so add new fields there. Project objects are immutable: `store.update(fn)`
clones, mutates the draft and saves (debounced) to IndexedDB. Internal names
(`reelflow` DB, `reelflow.*` localStorage keys, `.rf-*` CSS) kept the old product name
on purpose so users' local projects survived the rename.

## 7. How the pipelines work

**Preview.** `PlaybackEngine` keeps a hidden `<video>` per clip and derives project time
from the primary clip's `currentTime` (transition overlaps play two clips). Audio
presets route elements through a Web Audio chain created on first play.
`CanvasRenderer` runs a rAF loop: `Compositor.composite()` fills the clip's
background, draws "behind" overlays, the video layer (native or GLSL transition,
colour grade, matte mask), then front overlays and captions through the same renderer
the export uses, and returns element rectangles for hit-testing.

**Captions.** Audio is decoded once to 16 kHz mono, sliced to the clip's in/out, sent
to the ML worker. Whisper returns word timestamps which are mapped to project time and
grouped by `buildCues()` (max N words, 2.4 s, 0.6 s pause ends a cue, 0.25 s tail,
0.5 s minimum). With "Identify speakers" on, pyannote segmentation + WeSpeaker
embeddings are clustered and cues never cross a speaker change. Magic Cut and the
highlight finder both work from these word timings.

**Export.** `exporter.ts` splits the timeline into ~20 s segments, decides per segment
between the ffmpeg filter graph (cuts, xfade, static overlays as a PNG concat stream,
HDR tone-map, LUT/eq, audio presets, music/voice-over/sfx mix) and the canvas
compositor (GPU transitions, tracked overlays, reframed or matted clips, animated
captions/text, Lottie, behind-layer overlays → JPEG frame sequence), encodes each as a
fragmented MP4 and splices them while streaming to a Blob or a File System Access
writable. `docs/EXPORT-PIPELINE.md` documents every non-obvious flag; do not remove
any of them without re-running `npm test` (native parity) and the e2e.

## 8. Hard-won gotchas (keep these)

- **Threaded ffmpeg core dies on any non-zero exit** (`Aborted()` then the next exec
  hangs). Probe with `-i f -frames:v 1 -frames:a 1 -f null -`; `FFmpegEngine.exec`
  recycles the worker on failure; a 40 s log-silence watchdog throws `FFmpegHungError`
  and the exporter restarts single-threaded (`preferSingleThread`). Headless Chromium
  needed this fallback; desktop Chrome may not.
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
- **React Compiler lint** rejects `Date.now()` and ref reads in render paths; use
  `nowMs()` from `utils/time.ts` and assign refs in effects.
- **Anything drawn from a cache in the synchronous renderer** (Lottie frames, matte
  masks, LUTs) must be preloaded before offline capture; `captureFrames` does this.
- **Fonts:** next/font downloads at build time; canvas uses `fontFamily(key)` from the
  registry, and `ensureFontsLoaded()` runs before export.
- **Cloudflare Pages** caps files at 25 MiB; the loader falls back to unpkg for the cores.

## 9. Feature status

| Area | Status |
| --- | --- |
| Import, timeline, trim/speed/zoom/pan, transitions, text/stickers, music, undo, autosave | Done, exercised by the e2e |
| Whisper captions (WASM), caption builder, 20 styles, SRT/TXT/VTT | Done, e2e-verified (WebGPU path not exercised headless) |
| Export: filter path, segmented streaming, splice, sidecars | Done, e2e + native parity verified |
| Magic Cut, highlight finder | Done, unit-tested; UI wired |
| Recorder, hover preview, .nocap backups, sound effects, viral caption styles | Done, manually wired, no automated coverage |
| Audio presets, LUT/colour grading, scopes, Lottie overlays, text animations | Done; preview paths exercised, export via the compositor path, no automated coverage |
| Background removal (stickers) and video matting | Done; relies on `briaai/RMBG-1.4` via the `background-removal` pipeline (~45 MB download); WASM is slow (seconds per frame), WebGPU recommended |
| Export: compositor path (GPU transitions, tracked overlays, reframe) | Implemented, not covered by automated tests |
| 4K/60 fps, bitrate control, H.265, HDR tone-map, disk streaming | Implemented; HDR and disk sink untested with real files |
| Translation (browser API / Marian), speaker diarization, TTS voice-overs | Implemented, wrapped in graceful failure; not runtime-tested |
| Noise removal, motion tracking, auto-reframe, stock search | Implemented; not runtime-tested end to end |
| Eye-contact correction, stem separation, 10-bit output, in-browser Stable Diffusion | Not implemented (see `docs/ROADMAP.md`) |

## 10. UI / design system

The editor matches the owner's earlier macOS app ("Halycol"): Apple system dark colours
as `--color-sys-*` tokens in `src/app/globals.css`, monospace UI type, `.card` /
`.tile` / `.pill` / `.caps` classes, per-tool colours on the rail, Home|Edit control
with "Import clips" / "Export video", a notice strip ("Added 1 clip."), tile-based
inspector sections with uppercase labels and explanatory paragraphs, and the timeline
transport row with Earlier / Later / Remove. New panels should reuse `Tile`,
`PanelSection`, `Button`, `Field`, `Toggle`, `Slider` and the pill styles. Caption
typography is separate (presets in `captions/presets.ts`).

## 11. Debugging

`localStorage.setItem("reelflow.debug","1")` mirrors ffmpeg logs to the console;
`reelflow.singleThread=1` forces the single-threaded core; `?nocoi` disables the
isolation service worker. `e2e/results/` holds screenshots, exports and logs from
test runs. The e2e uses `E2E_URL` to target a deployed site and reads the ffmpeg log
from the console on failure.

## 12. Suggested next steps

1. Run the stretch features against real footage (matting, Lottie, LUTs, audio
   presets, diarization, TTS, reframe, noise removal, disk streaming) and fix API
   drift in the ML worker if any; add e2e coverage for the compositor export path.
2. Add a first-run explainer for model downloads (Whisper 45–600 MB, RMBG 45 MB).
3. Persist export settings and last-used models per user.
4. Video matting quality: consider a dedicated video-matting ONNX model (RVM) via
   onnxruntime-web for temporal stability and speed.
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
5. Pushed to GitHub, GitHub Pages workflow, custom domain nocapedit.com, HTTPS.
6. Restyled to the Halycol design; renamed to NoCap Edit.
7. Feature batch: Magic Cut, highlight finder, recorder, hover preview, .nocap
   backups, sound effects, viral caption styles, audio presets, colour grading + LUTs
   + scopes, Lottie overlays, text animations, behind-the-subject layer, background
   removal and video matting.
