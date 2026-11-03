@AGENTS.md

# Local workers (added 2026-11-03)

Routine typing goes to the local Qwen worker (the `qwen-gateway` MCP tools; config in `.gateway.toml`, which is
local-only and never committed) or to DeepSeek (`/pass-to-deepseek`). Claude writes the spec and reviews the diff.
The rules are the ones in `~/Developer/beezer/CLAUDE.md` ("Qwen Gateway — operating rules"); this is what differs here.

## Who gets what
- **Qwen** (free, local, about 20 s): one or two files under ~30 KB with a pattern to copy. A test in
  `src/__tests__`, a pure helper in `src/lib`, a copy or string change, a CSS tweak in one component. It writes
  whole files back, so never give it `src/components/mobile/MobileEditor.tsx` (67 KB),
  `src/components/timeline/TimelineDock.tsx` (42 KB), or any file it would have to rewrite from memory.
- **DeepSeek** (`run.sh`): routine work bigger than two files, or that needs reading around the code. Its ask mode
  (`~/.claude/skills/pass-to-deepseek/ask.sh ~/Desktop/Projects/reelflowWeb "<question>"`, read-only) answers
  "where is X / how does Y work" so Claude does not read source to write a spec.
- **Claude or DeepSeek, never Qwen:** `src/lib/mobile` (WebCodecs export, colour, the GPU compositor: Safari
  behaviour learned on the phone, not in any model's training), `src/lib/gl`, `src/lib/export`, `src/lib/color`,
  `src/lib/ffmpeg`, the `e2e/` scripts, anything under `src/app`, and anything that must be checked on the iPhone.

## What this repo expects (put it in every spec)
- Tests live in `src/__tests__/<name>.test.ts`, use `import { describe, expect, it } from "vitest"`, import code
  through the `@/` alias (= `src/`), and run in the node environment (no DOM, no window).
- The gate is `npm run lint`, `npm run typecheck`, `npm test`, in that order (434 tests, about 15 s together).
  Only lint errors fail it (warnings pass). eslint ignores `public/` (copied ffmpeg and MediaPipe bundles)
  since 2026-11-03; before that a clean tree had 19 errors from those bundles. Every spec says "no new lint errors in
  the files you touch", and Claude runs `npx eslint <those files>` in review.
- Never list `.env*`, `node_modules`, `out/`, or the copied ffmpeg files under `public/` for Qwen.
- This is Next.js 16 (see AGENTS.md) built as a static export: no server routes, no server actions.
- When the Mac Studio becomes the model box, only `base_url` and `model` in `.gateway.toml` change.
