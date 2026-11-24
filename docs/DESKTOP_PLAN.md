# Plan: NoCap Edit as a desktop app

Written 2026-11-23. Nothing in this plan has been built or tested yet.

## Decided by the owner (2026-11-23)

1. **Mac only, one user, not distributed**, like YouTube Desktop. No code signing, no installer, no
   Windows.
2. **Existing projects on nocapedit.com must come across.** See step 3.
3. **Fast export is the real goal.** The real ffmpeg program is step 5, part of the main plan.

## The short version

Wrap the existing site in an Electron window, the same way YouTube Desktop is built. The editor
itself does not change: `npm run build` already produces a complete static site in `out/`, and the
desktop app is a small shell that shows that folder in its own window. The website keeps working
exactly as it does today from the same code.

Electron is the right shell because it is Chrome inside. Everything the editor depends on was built
and tested on Chrome: the ffmpeg export, WebCodecs, WebGPU, IndexedDB. A shell built on Safari's
engine (Tauri on macOS) would bring the Safari problems of the phone editor to the desktop.

## What the shell has to get right

These come from how the editor works today, and each one is a way the desktop app could quietly be
worse than the website if it is skipped.

1. **Fast export needs three headers.** The multi-threaded ffmpeg only switches on when the page is
   "cross-origin isolated" (`src/lib/ffmpeg/loader.ts`). On the website the host sends the headers
   (`vercel.json`, `public/_headers`). Opening `out/index.html` straight from disk sends none, so
   export would silently fall back to the slow single-thread ffmpeg. The shell must serve `out/`
   through its own address (`app://nocap/`) and add the same three headers itself.
2. **Projects live in the browser's database.** Projects, versions and media are in IndexedDB
   `reelflow` (`src/lib/storage/db.ts`), tied to the address the page is loaded from. The app's
   address must be fixed from day one and never change, or every project disappears. Projects
   already saved on nocapedit.com in Chrome will not appear in the app by themselves (see open
   questions).
3. **Save dialogs.** Export streams to disk through Chrome's save and folder pickers
   (`src/lib/ffmpeg/sinks.ts`, `src/lib/utils/saveFolder.ts`). Whether these work inside Electron
   has to be tested. If they do not, exports fall back to holding the whole video in memory, which
   is bad for long films, and the shell must supply the native macOS dialogs instead.
4. **Things fetched from the internet.** Whisper and voice models (huggingface.co, jsdelivr), the
   MediaPipe face model (storage.googleapis.com), stock footage (Pexels, Pixabay, Openverse), notes
   (Google Apps Script) and the AI chat providers. The isolation headers in point 1 can block
   downloads from other sites, so each one must be checked in the app, not assumed.
5. **The YouTube helper.** The editor looks for it at `127.0.0.1:3131` or the Render address
   (`src/lib/youtube/service.ts`). The app can keep using the Render one at first.
6. **The phone editor (`/m/`) is not part of this.** Its link is already hidden on a computer.

## Steps

### Step 1: Prove it works (half a day, throwaway code)

A bare Electron window that serves `out/` at `app://nocap/` with the three headers. Then check by
hand, in this order:

- the page reports it is isolated and ffmpeg loads the multi-threaded core
- a project is still there after quitting and reopening
- a short clip imports, plays, and exports to a real MP4 file through the save dialog
- WebGPU and WebCodecs are reported as available on the start screen
- captions (Whisper download), a stock search, and auto-reframe (MediaPipe download) each work

**Done when:** every line above is ticked or has a named fix. If export cannot be made fast, stop
and rethink before building anything else.

#### Step 1 results (2026-11-23)

Run in a throwaway Electron 33 window (Chrome 130 inside, borrowed from YouTube Desktop's install)
showing a fresh `npm run build` at `app://nocap/`, driven by a script, on the M5 Max.

Passed:

- **Isolated, fast ffmpeg:** the page reports isolated, and the export loaded the multi-threaded
  core (`/ffmpeg/core-mt/`).
- **Export:** two copies of the 8-second test clip, 720p, fastest setting: rendered in about 2
  seconds to a valid 16.4-second H.264 + AAC file that decodes with no errors. It was saved through
  the plain download path, not the save dialog.
- **Projects survive a restart:** after quitting and reopening, the project and its media were
  still in the database and listed on the start screen. Storage is reported as persistent.
- **WebGPU, WebGL2, WebCodecs:** all available, including hardware H.264 encoding.
- **Captions:** Whisper tiny downloaded from huggingface.co and produced the right 6 captions in 7
  seconds.
- **Outside downloads are not blocked by the headers:** the MediaPipe face model, Openverse and
  Hugging Face all answered from inside the app.

Not checked yet, so still open:

- **The save dialog.** Chrome's save and folder pickers exist in Electron and the "Stream to a
  file" switch shows, but a script cannot click a macOS dialog. Needs one export by hand.
- **Playback** was not watched; only import and export were checked.
- **Auto-reframe and stock search through their own buttons.** Only the downloads they depend on
  were checked. Pexels and Pixabay need keys and were not tried.
- **A long or 4K export.** The test was 16 seconds at 720p; it says nothing about memory on a real
  film.

Found on the way: `e2e/smoke.mjs` looks for the export panel with `aside`, which now matches two
things since the Notes panel was added, so that script fails at the export step until it uses
`aside.rf-panel`.

Verdict: nothing blocks step 2.

### Step 2: The real shell

A new `desktop/` folder, plain JavaScript, no build step, same layout as YouTube Desktop:

- `desktop/main.js`: one window, the `app://` address with headers, a normal macOS menu, window
  size and position remembered, links to other sites open in the default browser, the page cannot
  navigate away from the app.
- `desktop/preload.js`: a short fixed list of things the page may ask the shell for. Empty at
  first; grows only in steps 5 and 6.
- `desktop/lib/`: small pure helpers (which file an `app://` address maps to, which headers to add)
  with unit tests in `src/__tests__/`.
- The page gets no Node access. `contextIsolation` on, `nodeIntegration` off.
- `npm run desktop` opens the app from source after a build.

**Done when:** the gate passes (`npm run lint`, `npm run typecheck`, `npm test`) and the step 1
checks pass again in the real shell.

#### Step 2 results (2026-11-23)

Built as planned, with two differences: the files are ES modules (`desktop/main.mjs`,
`desktop/lib/appUrl.mjs`) because the project's lint rules forbid `require`, and the preload is
`desktop/preload.cjs` because Electron requires that one file to be CommonJS. Electron 45.4.1
(Chrome 156 inside) is a dev dependency.

- `npm run desktop` builds the site and opens the app; `npm run desktop:open` opens it without
  rebuilding.
- Projects are kept in `~/Library/Application Support/NoCap Edit`. The address is `app://nocap`.
  Neither may ever change.
- The gate passes (lint 0 errors, typecheck clean, 637 tests passed, 1 skipped), including 15 new
  tests for the address helpers.
- The step 1 checks pass again in the real shell, run against a separate test data folder: isolated
  with the multi-threaded core, a 16-second export in about 2 seconds to a valid MP4, the project
  still there after a restart, WebGPU and WebCodecs available, captions correct. The page has no
  Node access.

Not checked: the items still open from step 1 (save dialog by hand, playback, auto-reframe and
stock search through their buttons, a long export), plus the new behaviours a script did not
exercise: the window remembering its size and position, links to other sites opening in the
default browser, and the single-copy lock.

### Step 3: Bring the existing projects across

The editor already has a backup for one project at a time: the start screen saves a project and
all its media as one `.nocap` file and can restore it (`src/lib/storage/backup.ts`). There is no
"all projects" version. So:

- add **Back up all projects** and **Restore all** to the start screen, built on the existing
  per-project functions (one `.nocap` file per project, saved into a folder you pick)
- this ships to the website first, so you can press it in Chrome on nocapedit.com
- then press **Restore all** in the desktop app and pick that folder

Not carried by a backup, to be set again by hand in the app: the notes link, AI and stock keys, and
the YouTube helper address (these are browser settings, not project data). Thumbnails and sound
waveforms are rebuilt automatically on restore.

The website copies stay where they are; nothing is deleted from Chrome.

**Done when:** every project on nocapedit.com opens in the app with its media and its saved
versions, checked project by project against the list in Chrome.

#### Step 3 results (2026-11-23)

Built: a **Back up all** button on the start screen (shown when there is at least one project)
writes one `.nocap` file per project into a folder you pick, and **Import backup** now accepts
several files at once. Code in `src/lib/storage/backupAll.ts` and
`src/components/start/StartScreen.tsx`, with 5 new tests. The gate passes.

Checked by script: two projects made in Chrome on the web build were backed up with Back up all,
both files were restored in the desktop app with one Import backup, and the project names and
media sizes matched. A restored project opened in the editor with its clip.

Not checked, and not done:

- **The folder dialog itself.** A script cannot click it, so the test stood in the browser's
  private folder for the one you would pick. Everything after the dialog was the real code.
- **Your real projects.** The test used two small test projects with no saved versions. The real
  move happens when you press the buttons: the website needs this change deployed first.
- **Restoring twice makes duplicates.** Each restore creates new projects; it does not notice a
  project is already there.
- **Card pictures.** Right after a restore the project cards show a placeholder picture, not a
  frame of the video. Whether they fill in after opening the project was not checked.
- Back up all needs Chrome or Edge on a computer; other browsers get a message pointing at the
  per-project Backup button.

### Step 4: Build and install

`scripts/build-app.sh`, modelled on YouTube Desktop's: build the site, package it with Electron as
"NoCap Edit.app" for Apple silicon, quit the old copy, install to /Applications, open the new one.
Not code signed, no self-update; a new version means running the script again. The existing
`rebuild-and-reopen-app` skill already expects a script with this name.

**Done when:** the app in /Applications opens from Spotlight and passes the step 1 checks.

### Step 5: Fast export with the real ffmpeg program

Today export runs ffmpeg compiled for the browser: slower than the real program, limited to 2 GB
of memory, and unable to use the Mac's video chip. In the app, the shell can run the real ffmpeg.

What makes this practical: the export already builds ordinary ffmpeg commands
(`src/lib/ffmpeg/exporter.ts`), one per roughly 20 seconds of film, and the output side is already
a narrow "write these bytes" interface (`src/lib/ffmpeg/sinks.ts`). What makes it real work: the
export code talks to the browser ffmpeg's private file area directly in several places
(`src/lib/ffmpegEngine.ts`), so there is no single plug to swap.

In order:

1. **Measure first.** Export the same one-minute project on the website and in the step 4 app and
   write the times down. This is the number every later change is judged against.
2. **A second engine behind the same commands.** In the app, source videos are read from real
   files on disk and the commands run in the real ffmpeg; on the website nothing changes. Same
   software encoder (x264) at first, so the picture is identical and only the speed differs.
3. **The ffmpeg program itself** is installed by the app into its own folder, checksum verified,
   the way YouTube Desktop installs yt-dlp. It must be a build that includes x264, x265, `zscale`
   and `loudnorm`, which the export uses and some builds leave out.
4. **Then the Mac's video chip** (VideoToolbox) as an export choice labelled "Fast". It is much
   faster but gives a slightly different picture at the same file size, so the careful x264 export
   stays as the default until you have compared them by eye.
5. Whole film in one go where the 20-second pieces were only there to fit the browser's memory.

The media still lives in the browser database, so item 2 above has to copy each source video out to
a temporary file before ffmpeg can read it. That costs disk space and a little time per export;
storing media as real files is a possible later change, not part of this plan.

**Done when:** the same project exports to a valid MP4 that passes the existing validators, the
time is written next to the first measurement, and the website export still works unchanged.

### Step 6: Make it feel like a Mac app

- native save and folder dialogs if Chrome's do not work in Electron (found in step 1)
- drag a video from Finder onto the Dock icon or window to import it
- File menu: New project, Open, Export, with the usual shortcuts
- a "you have an export running" warning before quitting

**Done when:** each item works in the built app.

### Step 7: An automatic check

`e2e/desktop.mjs`: Playwright (already installed) opens the real app, imports the test clip from
`e2e/fixtures`, exports it, and confirms the MP4 is valid with the existing validators. Not part of
the gate, run before each install. Written alongside step 5, since that is the step most likely to
break export.

### Later, only if wanted

- Store media as real files on disk instead of in the browser database.
- Bundle the Whisper, voice and face models inside the app so it works with no internet.
- Run the YouTube helper inside the app instead of on Render.
- Keep API keys in the macOS keychain instead of the browser's local storage.

## Who does what

Following the worker rules in `CLAUDE.md`:

- **Claude:** `desktop/main.js` and `desktop/preload.js` (the address, headers and security
  settings are easy to get subtly wrong), `e2e/desktop.mjs`, `scripts/build-app.sh`, anything that
  ends up touching `src/lib/ffmpeg` or `src/app`, and all review.
- **Studio worker:** the pure helpers in `desktop/lib/` and their tests, menu wording, small
  one-file changes.
- **Cloud DeepSeek:** routine work across more than two files, such as wiring menu items to the
  editor's existing actions.

## Risks

- **Slow export without anyone noticing.** If the headers are wrong, the app still works, just
  several times slower. The automatic check in step 7 must assert the multi-threaded core loaded.
- **Losing projects.** Changing the app's address, or its name on disk, orphans the database. Fix
  both in step 2 and write them in `CLAUDE.md`.
- **App size.** Electron is about 250 MB before the editor's own files (ffmpeg, MediaPipe, Lottie).
- **Two things to keep in step.** The site and the app share one codebase, but a change that works
  in Chrome could still break in the app's Chrome version. The step 7 check covers this.

- **Fast export gives a different picture.** The video chip's output is not identical to x264's.
  Step 5 keeps x264 as the default until the two have been compared by eye.
- **How much faster is unknown.** Nobody has measured it on this Mac with these projects. Step 5
  starts with the measurement for that reason.
