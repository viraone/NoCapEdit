# NoCap Edit

A browser-native video editor for solo creators. Drop in a recording and get a
captioned, platform-shaped vertical clip (Instagram Reels, TikTok, YouTube Shorts)
without uploading a single byte: transcription, translation, speaker detection,
noise removal, text-to-speech, compositing and MP4 encoding all run inside the
visitor's browser with WebAssembly, WebGL and WebGPU. The owner pays nothing per
user, only static hosting (free tier on Vercel, Netlify, Cloudflare Pages…).

## Features

**Editing**
- Multi-clip timeline with filmstrip thumbnails and audio waveforms, split at the
  playhead, reorder, trim in/out (drag the block edges), 0.25×–4× speed with pitch
  preservation (`atempo`) or pitch shift (`asetrate`), crop zoom 0.5×–4× (down to the Fit value when a tall frame needs less) and pan.
- 20 frame formats (Reels, TikTok, Shorts, Square, Widescreen…), safe-zone masks
  for Instagram Reels, TikTok and YouTube Shorts, canvas zoom.
- Transitions: 11 native xfade transitions plus 10 GLSL shader transitions
  (cross zoom, radial, directional warp, glitch, circle, pixelize, swirl, cube,
  dreamy, ripple) rendered with WebGL2 in the preview and in the export.
- Text titles and banners, image stickers, drag with alignment snapping, corner
  resize, double-click to edit, motion tracking that locks an element to a moving
  subject (template tracking, no ML download).
- Auto-reframe: MediaPipe face detection animates the pan so the subject stays
  centred when a landscape source is cut into a 9:16 reel.
- Music track with volume, fade in/out, start offset and looping; offline
  text-to-speech voice-overs (MMS-TTS via Transformers.js) placed on the timeline.
- Noise removal per clip with ffmpeg's RNNoise (`arnndn`) and spectral (`afftdn`)
  denoisers; the cleaned track replaces the clip audio in preview and export.
- Undo/redo, autosave to IndexedDB, project manager with thumbnails, storage usage.
- **Magic Cut**: one click removes filler words (from Whisper word timings) and dead
  air (from the waveform), re-timing captions, overlays and voice-overs.
- **Highlight finder**: TF-IDF salience plus delivery cues suggests the best 15/30/60 s
  window; "Keep only this" trims the reel to it.
- Screen / camera / screen+mic **recorder** (MediaRecorder) straight into the timeline;
  hover **filmstrip preview** on the timeline; **.nocap backups** (streamed zip of
  project + media, restorable on any device).
- **Sound effects** (synthesised, royalty-free) placed at the playhead or on every
  caption; **audio presets** (Voice, Podcast, Loud, Music) with matching Web Audio
  preview and ffmpeg export chains.
- **Colour**: brightness / contrast / saturation and `.cube` 3D LUTs (WebGL preview,
  `lut3d` + `eq` export), histogram and vectorscope.
- **Lottie** animations (.lottie / .json) as overlays, animated text entrances (pop,
  typewriter, slide, bounce), and a "behind the subject" layer.
- **Background removal**: MODNet on-device for stickers, and an offline matting
  pass that cuts the speaker out of a clip so text or stickers can sit behind them.

**Captions**
- Whisper (tiny → large-v3-turbo, `_timestamped` ONNX builds) with word-level
  timings, WebGPU when available, WASM otherwise. Fallback: Web Speech API live
  dictation.
- Caption builder rules: max 4 words, max 2.4 s, pause > 0.6 s ends a cue,
  0.25 s tail, 0.5 s minimum.
- 20 style presets (Social / Business / Retro, including Hormozi and Beast looks with
  pop/bounce word animation and keyword emoji) with per-word accent highlight
  (colour, box, scale, underline), size, position, width, colours, letter case,
  and a words-per-caption setting with re-grouping.
- Speaker identification (pyannote segmentation + WeSpeaker embeddings, clustered
  on-device); cues never cross a speaker change and can be coloured per speaker.
- Translation with the browser's built-in Translation API (Chrome) or Marian
  models (`Xenova/opus-mt-*`) on-device; show original or translated captions.
- Import/export SRT; export WebVTT with karaoke word timestamps and `<v Speaker>`
  voices; plain-text transcript.

**Export**
- ffmpeg.wasm inside a Web Worker, multi-threaded when the page is cross-origin
  isolated. Any resolution up to 4K/2160p, 24/30/60 fps, H.264 or H.265, CRF or
  target-bitrate rate control, x264/x265 presets.
- 10-bit HDR sources (BT.2020 PQ/HLG) are detected and tone-mapped to SDR with
  `zscale` + `tonemap`.
- Long renders are encoded in segments and streamed to a file on disk with the
  File System Access API (fragmented-MP4 splicing keeps one valid file), so memory
  stays flat; browsers without the API get a normal download.
- Two render paths chosen per segment: pure ffmpeg filter graphs (fast) or the
  canvas compositor (frame-accurate, used for GPU transitions, tracked overlays and
  auto-reframed clips) — both use the same renderer as the preview.

## Stack

Next.js 16 (App Router, static export, Turbopack), React 19, TypeScript, Tailwind 4,
Zustand, `idb`, `@ffmpeg/ffmpeg` + `@ffmpeg/core(-mt)`, `@huggingface/transformers`
(the maintained successor of `@xenova/transformers`, with WebGPU), `@mediapipe/tasks-vision`,
lucide icons.

Live build (GitHub Pages, custom domain): https://nocapedit.com

## Getting started

```bash
npm install
npm run dev        # copies the ffmpeg cores into public/ffmpeg, starts next dev
npm run build      # static export to out/
npm run test       # vitest unit tests (caption builder, timeline, filter graphs, fMP4, native ffmpeg parity)
npm run test:e2e   # Playwright smoke test against out/ (needs `npm run build` first)
npm run typecheck
```

Open http://localhost:3000. On first use the app registers a small service worker
that adds the COOP/COEP headers (see `docs/DEPLOYMENT.md`) so the multi-threaded
ffmpeg core can run; append `?nocoi` to skip it.

Models (Whisper, Marian, pyannote, WeSpeaker, MMS-TTS) are downloaded from the
Hugging Face Hub the first time they are used and cached by the browser.

## Deployment

Static host + three headers. `vercel.json`, `netlify.toml` and `public/_headers`
(Cloudflare Pages) are included; `docs/DEPLOYMENT.md` covers nginx, Caddy, Apache,
GitHub Pages and why the headers matter. `docs/EXPORT-PIPELINE.md` explains the
segmented/streamed export and the ffmpeg.wasm caveats; `docs/ROADMAP.md` lists what
was deliberately left out and why; `docs/HANDOFF.md` is the developer handoff.

## Project layout

```
src/
├── app/                      # start screen (/) and editor (/editor?id=…)
├── components/
│   ├── CanvasRenderer.tsx    # compositing surface (video + GLSL transitions + overlays + captions)
│   ├── canvas/               # VideoCanvas (interaction), SafeZoneGuide, CanvasBar, TransportBar
│   ├── timeline/             # TimelineDock, Filmstrip, AudioWaveform
│   ├── panels/               # ToolRail + Clips/Trim/Subtitles/Style/Text/Picture/Music/Export panels
│   └── ui/                   # primitives
├── lib/
│   ├── ffmpegEngine.ts       # WASM FFmpeg wrapper: probing, HDR, 4K/60fps/bitrate, segmented disk streaming
│   ├── transcriptionEngine.ts# Whisper + speaker diarization + WebVTT/SRT
│   ├── ffmpeg/               # loader, filter-graph builder, segments, fMP4 splicing, sinks, exporter, waveform
│   ├── speech/               # ML worker (Whisper, Marian, pyannote, WeSpeaker, MMS-TTS), captionBuilder, Web Speech
│   ├── captions/             # presets, canvas renderer, fonts, SRT
│   ├── playback/             # preview engine, frame drawing, compositor + offline frame capture
│   ├── gl/                   # WebGL2 GLSL transition engine
│   ├── tracking/             # template motion tracker, MediaPipe auto-reframe
│   ├── audio/                # RNNoise / spectral noise removal
│   ├── stock/                # Pexels / Pixabay search + download
│   ├── models/               # VideoProject types, formats, timeline math, placement
│   └── storage/              # IndexedDB driver
└── store/                    # Zustand editor store with undo history
```

## Data model

`VideoProject` (stored as JSON in IndexedDB, media as Blobs in a separate store):
clips (asset reference, in/out, speed, pitch mode, zoom, pan, transition, replacement
audio, reframe keyframes), cues (start/end, text, translation, word timings, detached
anchor, speaker), overlays (text banners/titles and image stickers with timing,
position, opacity, rotation, motion track), voice-overs, music (asset, volume,
fades, start offset, loop), subtitle style, caption settings, safe zone, frame format.

## Limits and honest notes

- Encoding speed depends on the device: ffmpeg.wasm x264 manages roughly 3–10 fps at
  1080×1920 on a laptop (faster with threads); 4K renders are slow but bounded in
  memory thanks to segment streaming.
- Whisper small/large need a capable GPU (WebGPU) to be pleasant; tiny/base run fine
  on WASM.
- Speaker identification works on the clip level; the same person across two clips
  is labelled separately.
- Web Speech dictation only hears the microphone, so timings are approximate.
- Not implemented (documented in `docs/ROADMAP.md`): eye-contact correction, full
  vocal/stem separation, capturing `speechSynthesis` audio into the file.
