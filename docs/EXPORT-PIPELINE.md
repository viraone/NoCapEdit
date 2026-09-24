# Export pipeline internals

This documents the non-obvious decisions in `src/lib/ffmpegEngine.ts`,
`src/lib/ffmpeg/exporter.ts`, `src/lib/ffmpeg/segments.ts` and `src/lib/ffmpeg/mp4.ts`.
Every one of them was found the hard way; keep them when refactoring.

## Two render paths

| Path | When | How |
| --- | --- | --- |
| filters | cuts, xfade transitions, static overlays | one `-filter_complex` graph per segment: trim, `setpts` speed, `atempo`/`asetrate`, crop/scale or scale+overlay, `xfade`/`acrossfade`, caption/overlay PNG layer via the concat demuxer, `zscale`+`tonemap` for HDR, music/voice-over `amix` |
| compositor | GLSL transitions, motion-tracked overlays, auto-reframed clips | the canvas compositor renders every frame (`captureFrames`), JPEG frames go to the worker FS and ffmpeg encodes `-framerate fps -i f%05d.jpg` with the same audio graph |

`needsCompositor()` decides per segment, so a project mixes both paths freely.

## Segments and streaming

`planSegments()` cuts the timeline into ~20 s pieces, never inside a transition
(a margin keeps `xfade` fed). Each piece is a self-contained render whose output
is a fragmented MP4 (`frag_keyframe+empty_moov+default_base_moof`). The engine
splices them into one file while streaming to the sink:

1. Segment 0 keeps `ftyp`+`moov` (with `mvex`), trailing `mfra` is dropped.
2. Later segments drop `ftyp`/`moov`/`sidx`/`mfra`; only `moof`+`mdat` remain.
3. `mfhd` sequence numbers are renumbered continuously.
4. **Fragment decode times are rewritten.** The mov muxer normalises every file
   to start at decode time 0 and encodes the real start in an edit list that
   lives in `moov`, so `-output_ts_offset`, `setpts` shifts and friends all end
   up as tfdt 0. `shiftFragments()` adds `start × timescale` to every `tfdt`
   using the timescales read from segment 0's `moov` (`parseTrackTiming`).
5. Video: `-bf 0` for segmented renders so decode order has no delay at seams,
   a final `fps=` filter regularises timestamps after `xfade`/`overlay`, and
   `-avoid_negative_ts disabled` stops the muxer from stretching the first frame
   by one audio frame.
6. Audio: each AAC segment carries 1024 samples of encoder priming at its head.
   Segment 0's edit list hides its own; later segments have no edit list, so
   the exporter shortens every non-final segment's audio by exactly one AAC
   frame (`audioTailTrim`) and the priming frame of the next segment fills the
   gap. Result: monotonic timestamps, no drift, a 21 ms near-silent dip at each
   seam that is inaudible in speech content.

`src/__tests__/nativeParity.test.ts` runs the generated commands through the
native ffmpeg binary and validates the spliced file (duration, clean decode,
packet continuity). Run it whenever the graph or the encoder flags change.

## ffmpeg.wasm specifics

- `@ffmpeg/core-mt` (threads) dies on **any** command that exits non-zero: the
  runtime calls `abort()` and the next `exec` hangs after printing the stream
  mapping. Probing therefore uses `-i file -frames:v 1 -frames:a 1 -f null -`
  (exit 0), and `FFmpegEngine.exec` recycles the worker after a failure.
- Some environments (headless Chromium with SwiftShader was one) deadlock the
  threaded core on the first decode. A watchdog (`WATCHDOG_SECONDS` of log
  silence) throws `FFmpegHungError`; the exporter switches to the single-threaded
  core (`preferSingleThread`), resets the sink and restarts the whole export.
- "Aborted()" in the ffmpeg log is normal at the end of every command: the core
  implements `exit()` with a thrown abort that the wrapper swallows.
- The class worker and both cores are served same-origin from `public/ffmpeg`
  (copied by `scripts/copy-ffmpeg.mjs`); the loader falls back to unpkg when the
  32 MB wasm is missing (Cloudflare Pages' 25 MiB file limit).
- Inputs are mounted with WORKERFS (no copy into the wasm heap); outputs are
  read back per segment and deleted immediately.

## Debugging

Set `localStorage.setItem("reelflow.debug", "1")` to mirror every ffmpeg log
line to `console.debug("[ffmpeg]", …)`, and `reelflow.singleThread=1` to force
the single-threaded core. `npm run test:e2e` (Playwright + the fixture clip)
imports two clips, adds a crossfade, transcribes with Whisper tiny on WASM,
exports a two-segment 720p file and validates it with ffprobe.
