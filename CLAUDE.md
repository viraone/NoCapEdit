@AGENTS.md

# Local workers (added 2026-11-03)

Routine typing goes to the gateway worker, which is Qwen3.8-Flash-Next on the Mac Studio, on live trial since 2026-11-21, with DeepSeek V4-Flash kept there as the fallback (the one line to go back is in `.gateway.toml`; Claude does not switch models on its own) (the `qwen-gateway` MCP tools, a historical name; config in `.gateway.toml`, which is local-only and never committed) or to cloud DeepSeek (`/pass-to-deepseek`). Claude writes the spec and reviews the diff.
The rules are the ones in `~/Developer/beezer/CLAUDE.md` ("Qwen Gateway — operating rules"); this is what differs here.

## Who gets what
- **Studio worker** (free, runs on the Mac Studio, about 35 s plus 45 s per 60 KB of listed files): up to about six files with a pattern to copy. A test in
  `src/__tests__`, a pure helper in `src/lib`, a copy or string change, a CSS tweak in one component. Since
  2026-11-04 it edits files with SEARCH/REPLACE blocks instead of rewriting them, so a small, well-specified
  change in `src/components/mobile/MobileEditor.tsx` (67 KB) or `src/components/timeline/TimelineDock.tsx`
  (42 KB) is fine to give it; what still rules a file out is the list below, not its size. When the gate fails,
  the retry automatically gets the files the errors name, and a failed task is undone by the gateway.
- **DeepSeek** (`run.sh`): routine work bigger than two files, or that needs reading around the code. Its ask mode
  (`~/.claude/skills/pass-to-deepseek/ask.sh ~/Desktop/Projects/reelflowWeb "<question>"`, read-only) answers
  "where is X / how does Y work" so Claude does not read source to write a spec.
- **Claude or cloud DeepSeek, never the Studio worker:** `src/lib/mobile` (WebCodecs export, colour, the GPU compositor: Safari
  behaviour learned on the phone, not in any model's training), `src/lib/gl`, `src/lib/export`, `src/lib/color`,
  `src/lib/ffmpeg`, the `e2e/` scripts, anything under `src/app`, and anything that must be checked on the iPhone.

## What this repo expects (put it in every spec)
- Tests live in `src/__tests__/<name>.test.ts`, use `import { describe, expect, it } from "vitest"`, import code
  through the `@/` alias (= `src/`), and run in the node environment (no DOM, no window).
- The gate is `npm run lint`, `npm run typecheck`, `npm test`, in that order (434 tests, about 15 s together).
  Only lint errors fail it (warnings pass). eslint ignores `public/` (copied ffmpeg and MediaPipe bundles)
  since 2026-11-03; before that a clean tree had 19 errors from those bundles. Every spec says "no new lint errors in
  the files you touch", and Claude runs `npx eslint <those files>` in review.
- Never list `.env*`, `node_modules`, `out/`, or the copied ffmpeg files under `public/` for the worker.
- This is Next.js 16 (see AGENTS.md) built as a static export: no server routes, no server actions.

# Desktop app (added 2026-11-23)

`desktop/` is an Electron shell that shows the built site (`out/`) in a window; the plan and what has been checked are in `docs/DESKTOP_PLAN.md`. `npm run desktop` builds and opens it, `npm run desktop:open` opens it without rebuilding.
- **Never change** the address `app://nocap` (`desktop/lib/appUrl.mjs`) or the app name "NoCap Edit" (`desktop/main.mjs`). Projects live in IndexedDB under that address, inside `~/Library/Application Support/NoCap Edit`; changing either makes every saved project disappear.
- `NOCAP_DATA_DIR=<folder>` points the app at another data folder. Use it for every test run so tests never touch the real projects.
- `desktop/main.mjs` and `desktop/preload.cjs` are Claude's (address, headers, security settings). Pure helpers in `desktop/lib/` with tests in `src/__tests__/` (imported by relative path, since `@/` only covers `src/`) can go to the Studio worker.
- The page gets no Node access. Anything it needs from the shell is added to the fixed list in `desktop/preload.cjs`.
