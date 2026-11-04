// Copies the ffmpeg.wasm class worker and the single/multi-threaded cores into
// public/ffmpeg so they are served same-origin (workers cannot import
// cross-origin scripts, and same-origin avoids CDN dependencies).
import { cpSync, mkdirSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const extra = [
  ["@mediapipe/tasks-vision/wasm", join(root, "public", "mediapipe", "wasm")],
  ["@lottiefiles/dotlottie-web/dist", join(root, "public", "lottie")],
];

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

/**
 * The multi-threaded core is built with a fixed 1 GB heap that cannot grow, and
 * x264 at 4K needs more than that: the export died with "Aborted(OOM)" on its
 * first frame. Both places that say 1 GB are changed to 2 GB: the constant in
 * the load script, and the memory limit the wasm binary declares for its
 * imported memory (the engine refuses a bigger block otherwise). 2 GB is the
 * ceiling for this build, whose JS side reads addresses as signed 32-bit
 * numbers. The patch checks for the exact bytes it expects, so a new core
 * version fails loudly here instead of quietly going back to 1 GB.
 */
const THREADED_HEAP_PAGES = 32768; // 64 KiB pages: 2 GB
function patchThreadedCoreMemory(dir) {
  const jsPath = join(dir, "ffmpeg-core.js");
  const js = readFileSync(jsPath, "utf8");
  const needle = 'Module["INITIAL_MEMORY"]||1073741824';
  if (js.split(needle).length !== 2) throw new Error("[copy-ffmpeg] core-mt: the INITIAL_MEMORY constant was not found exactly once; the core changed, update the patch");
  writeFileSync(jsPath, js.replace(needle, `Module["INITIAL_MEMORY"]||${THREADED_HEAP_PAGES * 65536}`));
  const wasmPath = join(dir, "ffmpeg-core.wasm");
  const wasm = readFileSync(wasmPath);
  // Import entry: module "a", field "a", kind memory, limits flags 3 (has max, shared), min 16384 pages, max 16384 pages.
  const before = Buffer.from([0x01, 0x61, 0x01, 0x61, 0x02, 0x03, 0x80, 0x80, 0x01, 0x80, 0x80, 0x01]);
  const after = Buffer.from([0x01, 0x61, 0x01, 0x61, 0x02, 0x03, 0x80, 0x80, 0x01, 0x80, 0x80, 0x02]);
  const at = wasm.indexOf(before);
  if (at < 0 || wasm.indexOf(before, at + 1) >= 0) throw new Error("[copy-ffmpeg] core-mt: the memory import was not found exactly once in the wasm; the core changed, update the patch");
  after.copy(wasm, at);
  writeFileSync(wasmPath, wasm);
}

/** Proves the patched binary accepts a 2 GB memory block (dummy imports; nothing runs). */
async function checkThreadedCoreMemory(dir) {
  const mod = await WebAssembly.compile(readFileSync(join(dir, "ffmpeg-core.wasm")));
  const memory = new WebAssembly.Memory({ initial: THREADED_HEAP_PAGES, maximum: THREADED_HEAP_PAGES, shared: true });
  const imports = {};
  for (const i of WebAssembly.Module.imports(mod)) {
    imports[i.module] ??= {};
    imports[i.module][i.name] =
      i.kind === "memory" ? memory : i.kind === "function" ? () => 0 : i.kind === "table" ? new WebAssembly.Table({ initial: 1, element: "anyfunc" }) : new WebAssembly.Global({ value: "i32", mutable: true }, 0);
  }
  await WebAssembly.instantiate(mod, imports);
}

const threadedCore = join(out, "core-mt");
if (existsSync(join(threadedCore, "ffmpeg-core.wasm"))) {
  patchThreadedCoreMemory(threadedCore);
  await checkThreadedCoreMemory(threadedCore);
  console.log(`[copy-ffmpeg] core-mt heap raised to ${(THREADED_HEAP_PAGES * 65536) / 2 ** 30} GB`);
}

for (const [src, dest] of extra) {
  const from = join(root, "node_modules", src);
  if (!existsSync(from)) continue;
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(from, dest, { recursive: true, filter: (f) => !f.endsWith(".d.ts") && !f.endsWith(".map") && (f.endsWith(".wasm") || !f.includes("dotlottie-web/dist/") || f.endsWith("dist")) });
  console.log(`[copy-ffmpeg] ${src} -> ${dest.replace(root + "/", "")}`);
}
