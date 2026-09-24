# Roadmap / feasibility notes

Everything in ReelFlow must run in the browser with zero server cost. This page
records what was implemented for the "CapCut-class" feature set and what was
deliberately left as a plan, with the reason.

| Feature | Status | Notes |
| --- | --- | --- |
| 4K / 60 fps / custom bitrate export | Done | `lib/ffmpegEngine.ts`: resolution presets to 2160p, 24/30/60 fps, CRF or `-b:v`/`-maxrate`, x264/x265 presets |
| 10-bit HDR sources | Done (tone-map) | HDR (PQ/HLG, BT.2020) is detected from the probe and tone-mapped to SDR with `zscale`/`tonemap`. 10-bit *output* is not offered: the wasm x264/x265 builds are 8-bit |
| Streaming to disk (no OOM) | Done | Segmented fragmented-MP4 render, `showSaveFilePicker` writable stream, init-segment stripping + fragment renumbering (`lib/ffmpeg/mp4.ts`) |
| Watermark-free compositing | Done | Canvas/WebGL compositor shared by preview and export (`components/CanvasRenderer.tsx`) |
| Motion tracking | Done (2D) | NCC template tracker (`lib/tracking/templateTracker.ts`); locks text/stickers to a moving point. Camera solve / 3D tracking: not feasible client-side at acceptable quality |
| Noise removal | Done | ffmpeg `arnndn` (RNNoise) and `afftdn`; produces replacement audio per clip |
| Vocal isolation (stem separation) | Plan | Needs Demucs/Spleeter-class models (hundreds of MB, minutes of compute on CPU). Plan: ONNX Demucs-lite via onnxruntime-web WebGPU when a small enough export exists |
| Speaker-ID captions | Done | pyannote segmentation 3.0 + WeSpeaker embeddings + agglomerative clustering in the ML worker; WebVTT `<v Speaker N>` output |
| Auto-reframing | Done | MediaPipe Face Detector (BlazeFace) → smoothed pan keyframes |
| Eye-contact correction | Not feasible | Requires a gaze-redirection generative model; no lightweight, licensed browser model exists. The face landmarks path (MediaPipe Face Landmarker) is in place for a future warp-based approximation |
| Text-to-speech | Done | MMS-TTS (VITS) via Transformers.js, 12 languages; `speechSynthesis` for previews only because browsers cannot capture its audio |
| GLSL transitions | Done | 10 shaders in `lib/gl/transitions.ts`; exported through the compositor path |
| Stock media | Done | Pexels / Pixabay search with the user's own free key (browser → provider, no proxy) |
