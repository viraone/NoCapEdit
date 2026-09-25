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
(a margin keeps `xfade` fed). Cuts snap to `segmentGrid(fps)`, the smallest
period that is a whole number of video frames *and* of 1024-sample AAC frames
(0.533 s at 30/60 fps), so every segment's audio track ends exactly on a frame
boundary. Each piece is a self-contained render whose output is a fragmented
MP4 (`frag_keyframe+empty_moov+default_base_moof+delay_moov`; `delay_moov`
holds the moov until the first fragment so it can carry the audio edit list).
The engine splices them into one file while streaming to the sink:

1. Segment 0 keeps `ftyp`+`moov` (with `mvex`), trailing `mfra` is dropped.
2. Later segments drop `ftyp`/`moov`/`sidx`/`mfra`; only `moof`+`mdat` remain.
3. `mfhd` sequence numbers are renumbered continuously.
4. **Fragment decode times are rewritten.** The mov muxer normalises every file
   to start at decode time 0, so `-output_ts_offset`, `setpts` shifts and friends
   all end up as tfdt 0. `shiftFragments()` adds `start × timescale` to every
   `tfdt` using the timescales read from segment 0's `moov` (`parseTrackTiming`).
   Segment 0's edit list (audio `media_time` 1024 = the AAC priming) stays in
   the retained `moov` and applies to the whole spliced track.
5. Video: `-bf 0` for segmented renders so decode order has no delay at seams,
   a final `fps=` filter regularises timestamps after `xfade`/`overlay`, and
   `-avoid_negative_ts disabled` stops the muxer from stretching the first frame
   by one audio frame.
6. Audio: each AAC segment carries 1024 samples of encoder priming at its head,
   hidden by the retained edit list. The exporter shortens every non-final
   segment's audio by exactly one AAC frame (`atrim=end_sample`, `audioTailTrim`)
   and the priming frame of the next segment fills the gap. Result: contiguous
   `tfdt` on both tracks, 0 ms A/V offset at every seam (measured with the
   flash/click fixture), and a ~20 ms near-silent dip at each seam that is
   inaudible in speech content and, measured directly against background
   music, still under the roughly 20–50 ms gap-perceptibility threshold most
   listeners have for music (not full silence: the mix stays around -38 dBFS
   through the dip, since it is a codec-priming artefact, not a decode gap).
   Without `delay_moov` the priming played as content and audio lagged by
   21–26 ms in segmented exports. A rewrite that removes the dip entirely
   (drop the shared AAC frame at the boundary and shift trun/moof so the same
   MDCT window is decoded once, not split across segments) was scoped and
   rejected as disproportionate: it touches every segmented export, the disk
   sink and the watchdog-restart path for a sub-perceptual improvement. See
   `docs/HANDOFF.md`'s note on the music seam gap (D-21) for the measurement
   that decision was based on.
7. Music input seek: seeking an MP3 mid-file (`-ss` before `-i`) restarts the
   decoder with none of the preceding frames' bit-reservoir data, so its first
   ~10–140 ms (worse at low bitrates) decode as silence — the same effect at
   every segment's music seek, not just at export start. `splitMusicSeek()`
   (`src/lib/ffmpeg/filters.ts`) seeks one second earlier than the real start
   and the `[mus]` filter chain drops that second with `atrim=start=`, so the
   decoder is warm before the kept audio begins. This cut the measured seam
   dropout from 120 ms to the ~20 ms priming dip in point 6 above.

`src/__tests__/nativeParity.test.ts` runs the generated commands through the
native ffmpeg binary and validates the spliced file (duration, clean decode,
packet continuity). Run it whenever the graph or the encoder flags change.

## ffmpeg.wasm specifics

- `@ffmpeg/core-mt` (threads) dies on **any** command that exits non-zero: the
  runtime calls `abort()` and the next `exec` hangs after printing the stream
  mapping. Probing therefore uses `-i file -frames:v 1 -frames:a 1 -f null -`
  (exit 0), and `FFmpegEngine.exec` recycles the worker after a failure.
- **The threaded core deadlocks when a command needs more pthreads than the
  pre-spawned pool (32).** `-threads auto` on a many-core machine asks for far
  more (x264 alone wants 1.5× the cores, every decoder and filter graph a full
  set); the extra worker can never finish loading because the class worker is
  blocked inside the synchronous exec, so the command hangs after "Stream
  mapping". `FFmpegEngine.exec` therefore inserts a budgeted `threadPlan()`
  (`-threads` per input, for the encoder, and `-filter_threads`) into every
  command on the threaded core. With the caps the probe returns in ~40 ms and a
  720p encode runs ~3× faster than single-threaded.
- Watchdogs cover both cores (`WATCHDOG_SECONDS` = 40 s threaded, 180 s
  single-threaded, the latter because slow presets are quiet while filling
  lookahead). A hang throws `FFmpegHungError`; `render()` reloads the engine and
  resumes from the segment that stalled (earlier segments stay in the sink), and
  a threaded hang also persists `reelflow.singleThread=1` so later sessions skip
  the wait. The Export panel shows the engine actually used.
- "Aborted()" in the ffmpeg log is normal at the end of every command: the core
  implements `exit()` with a thrown abort that the wrapper swallows.
- The class worker and both cores are served same-origin from `public/ffmpeg`
  (copied by `scripts/copy-ffmpeg.mjs`); the loader falls back to unpkg when the
  32 MB wasm is missing (Cloudflare Pages' 25 MiB file limit).
- Inputs are mounted with WORKERFS (no copy into the wasm heap) on both cores;
  outputs are read back per segment and deleted immediately.

## Debugging

Set `localStorage.setItem("reelflow.debug", "1")` to mirror every ffmpeg log
line to `console.debug("[ffmpeg]", …)`, and `reelflow.singleThread=1` to force
the single-threaded core. `npm run test:e2e` (Playwright + the fixture clip)
imports two clips, adds a crossfade, transcribes with Whisper tiny on WASM,
exports a two-segment 720p file and validates it with ffprobe.
