// Copies the ffmpeg.wasm class worker and the single/multi-threaded cores into
// public/ffmpeg so they are served same-origin (workers cannot import
// cross-origin scripts, and same-origin avoids CDN dependencies).
import { cpSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ffmpeg");
const sources = [
  ["@ffmpeg/ffmpeg/dist/esm", "ffmpeg"],
  ["@ffmpeg/core/dist/esm", "core"],
  ["@ffmpeg/core-mt/dist/esm", "core-mt"],
];
// MediaPipe vision runtime (face detection for auto-reframe), served same-origin.
const extra = [["@mediapipe/tasks-vision/wasm", join(root, "public", "mediapipe", "wasm")]];

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const [src, dest] of sources) {
  const from = join(root, "node_modules", src);
  if (!existsSync(from)) {
    console.warn(`[copy-ffmpeg] missing ${from}, run npm install first`);
    continue;
  }
  cpSync(from, join(out, dest), {
    recursive: true,
    // Type declarations are useless on a static host and confuse tsc's globbing.
    filter: (src) => !src.endsWith(".d.ts") && !src.endsWith(".d.mts") && !src.endsWith(".map"),
  });
  console.log(`[copy-ffmpeg] ${src} -> public/ffmpeg/${dest}`);
}
for (const [src, dest] of extra) {
  const from = join(root, "node_modules", src);
  if (!existsSync(from)) continue;
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(from, dest, { recursive: true, filter: (f) => !f.endsWith(".d.ts") });
  console.log(`[copy-ffmpeg] ${src} -> ${dest.replace(root + "/", "")}`);
}
