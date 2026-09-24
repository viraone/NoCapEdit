// Verification suite for the 2026-09-24 QA audit fixes. Drives the exported
// site (npm run build) in Chromium and checks:
//   lut       LUT colour grading renders (identity unchanged, warm shifts R/B)
//   keys      S and Ctrl/Cmd+B split at the playhead; undo restores
//   dnd       clip blocks reorder by dragging on the video lane
//   dblclick  double-clicking a title focuses its textarea with the text selected
//   matte     sticker background removal and subject cut-out produce alpha masks
//   export    multi-threaded engine is used without the 40 s stall, spliced
//             segments keep A/V sync, files validate (mp4check, syncmeasure, ffmpeg)
//   speed     multi-threaded export is >= 2x faster than the single-threaded run
//   pages     no console errors on / and /editor/; favicon, manifest, robots served
//
// Usage: node e2e/qa.mjs [--only=lut,keys,...] [--gpu=off] [--channel=chromium] [--headed]
//   --channel=chromium uses the full browser (new headless mode) so WebGPU gets
//   the real GPU; the default headless shell only has a slow software adapter.
// Needs ffmpeg/ffprobe and python3 on the PATH. E2E_URL runs against a deployed site.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const port = Number(process.env.QA_PORT ?? 4174);
const fx = (name) => join(here, "fixtures", name);
const outDir = join(here, "results", "qa");
mkdirSync(outDir, { recursive: true });
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? "1"]));
const only = args.only ? new Set(args.only.split(",")) : null;
const want = (name) => !only || only.has(name);
const gpuOff = args.gpu === "off";

const remote = process.env.E2E_URL?.replace(/\/?$/, "/");
const baseUrl = remote ?? `http://localhost:${port}/`;
const server = remote ? null : spawn(process.execPath, [join(here, "serve.mjs"), join(root, "out"), String(port)], { stdio: "ignore" });
if (!remote) await new Promise((r) => setTimeout(r, 800));

const t0 = Date.now();
const now = () => ((Date.now() - t0) / 1000).toFixed(1);
const log = (...a) => console.log(now().padStart(6), ...a);
const results = [];
const record = (id, ok, details) => {
  results.push({ id, ok, details });
  console.log(`${ok ? "PASS" : "FAIL"} ${id} ${JSON.stringify(details).slice(0, 600)}`);
};

const browserArgs = ["--autoplay-policy=no-user-gesture-required", "--disable-features=BlockInsecurePrivateNetworkRequests"];
if (gpuOff) browserArgs.push("--disable-features=WebGPU");
else browserArgs.push("--enable-unsafe-webgpu", "--enable-features=WebGPU");
const browser = await chromium.launch({ headless: !args.headed, args: browserArgs, ...(args.channel ? { channel: args.channel } : {}) });

async function makeContext(opts = {}) {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 950 } });
  await context.addInitScript((single) => {
    localStorage.setItem("reelflow.debug", "1");
    if (single) localStorage.setItem("reelflow.singleThread", "1");
    else localStorage.removeItem("reelflow.singleThread");
  }, !!opts.singleThread);
  const page = await context.newPage();
  const console_ = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    const text = m.text();
    console_.push({ t: Date.now(), type: m.type(), text: text.slice(0, 400) });
    if (m.type() === "error") errors.push(`console.error: ${text.slice(0, 300)}`);
  });
  return { context, page, console_, errors };
}

const store = (page) => page.evaluate(() => window.__nocap.useEditor.getState());
const seek = (page, t) => page.evaluate((t) => window.__nocap.useEditor.getState().seek(t), t);
const clipIds = async (page) => (await store(page)).project.clips.map((c) => c.id);
const rail = (page) => page.getByRole("navigation", { name: "Tools" });
const tool = (page, name) => rail(page).getByRole("button", { name, exact: true }).click();
const aside = (page) => page.locator("aside");
const readProject = (page, id) =>
  page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("reelflow");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const p = await new Promise((res, rej) => {
      const t = db.transaction("projects").objectStore("projects").get(id);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
    db.close();
    return p;
  }, id);
/** Reads an asset blob's type/size and counts non-opaque pixels when it is an image. */
const inspectAsset = (page, id) =>
  page.evaluate(async (id) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open("reelflow");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const a = await new Promise((res, rej) => {
      const t = db.transaction("assets").objectStore("assets").get(id);
      t.onsuccess = () => res(t.result);
      t.onerror = () => rej(t.error);
    });
    db.close();
    if (!a) return null;
    const out = { type: a.blob.type, size: a.blob.size };
    if (a.blob.type.startsWith("image/")) {
      const bmp = await createImageBitmap(a.blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      let transparent = 0;
      let opaque = 0;
      for (let i = 3; i < d.length; i += 4) {
        if (d[i] < 255) transparent++;
        if (d[i] === 255) opaque++;
      }
      Object.assign(out, { width: bmp.width, height: bmp.height, transparent, opaque });
    }
    return out;
  }, id);
/** Mean RGB of the preview canvas. */
const canvasMean = (page) =>
  page.evaluate(() => {
    const canvas = document.querySelector("main canvas");
    const ctx = canvas.getContext("2d");
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = d.length / 4;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    return { r: r / n, g: g / n, b: b / n };
  });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Quick-imports a clip from the start page and waits for the editor. Returns the project id. */
async function openProjectWith(page, file) {
  await page.goto(baseUrl);
  await page.waitForSelector("text=NoCap Edit");
  await page.waitForFunction(() => crossOriginIsolated || performance.now() > 8000, null, { timeout: 15000 }).catch(() => {});
  await page.locator('input[type="file"][accept^="video"]').first().setInputFiles([file]);
  await page.waitForURL(/\/editor\/?\?id=/, { timeout: 120_000 });
  await page.waitForFunction(() => !!window.__nocap && window.__nocap.useEditor.getState().project?.clips.length > 0, null, { timeout: 60_000 });
  await wait(500);
  return new URL(page.url()).searchParams.get("id");
}

async function addClip(page, file) {
  await tool(page, "Clips");
  const before = (await clipIds(page)).length;
  await aside(page).locator('input[type="file"][accept^="video"]').first().setInputFiles([file]);
  await page.waitForFunction((n) => window.__nocap.useEditor.getState().project.clips.length > n, before, { timeout: 60_000 });
  await wait(300);
}

async function setOff(page, name) {
  const toggle = page.getByRole("switch", { name });
  if ((await toggle.count()) && (await toggle.first().getAttribute("aria-checked")) === "true") await toggle.first().click();
}

// ---------------------------------------------------------------------------
// pages: console errors + static files
// ---------------------------------------------------------------------------
async function testPages() {
  const { context, page, errors } = await makeContext();
  await page.goto(baseUrl);
  await page.waitForSelector("text=NoCap Edit");
  await wait(1500);
  const statics = {};
  for (const f of ["favicon.ico", "manifest.webmanifest", "apple-touch-icon.png", "robots.txt", "icon-192.png"]) {
    statics[f] = await page.evaluate(async (f) => (await fetch(f)).status, f);
  }
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('link[rel~="icon"],link[rel="manifest"],link[rel="apple-touch-icon"]')).map((l) => `${l.rel}=${l.getAttribute("href")}`));
  const homeErrors = [...errors];
  errors.length = 0;
  await page.goto(`${baseUrl}editor/?id=nope`);
  await page.waitForSelector("text=no longer exists", { timeout: 30_000 }).catch(() => {});
  await wait(1500);
  const editorErrors = [...errors];
  record("pages.static", Object.values(statics).every((s) => s === 200), { statics, links });
  record("pages.console", homeErrors.length === 0 && editorErrors.length === 0, { homeErrors, editorErrors });
  await context.close();
}

// ---------------------------------------------------------------------------
// lut / keys / dnd / dblclick / matte on the face-sweep clip
// ---------------------------------------------------------------------------
async function testEditor() {
  const { context, page, errors } = await makeContext();
  const id = await openProjectWith(page, fx("face_sweep_1080p.mp4"));
  log("editor project", id);

  if (want("lut")) {
    await tool(page, "Trim");
    await seek(page, 4.5);
    await wait(700);
    const base = await canvasMean(page);
    const lutInput = aside(page).locator('input[type="file"][accept=".cube"]');
    await lutInput.setInputFiles(fx("identity2.cube"));
    await page.waitForSelector("text=Applied LUT", { timeout: 15_000 });
    await wait(900);
    const identity = await canvasMean(page);
    const notBlack = identity.r + identity.g + identity.b > 30;
    const same = Math.abs(identity.r - base.r) < 4 && Math.abs(identity.g - base.g) < 4 && Math.abs(identity.b - base.b) < 4;
    record("lut.identity", notBlack && same, { base, identity });
    await aside(page).getByRole("button", { name: "Remove", exact: true }).click();
    await wait(300);
    await lutInput.setInputFiles(fx("warm.cube"));
    await page.waitForSelector("text=Applied LUT Warm", { timeout: 15_000 });
    await wait(900);
    const warm = await canvasMean(page);
    record("lut.warm", warm.r > base.r + 2 && warm.b < base.b - 2, { base, warm });
    const glErrors = errors.filter((e) => /WebGL|texImage3D/.test(e));
    record("lut.noGlErrors", glErrors.length === 0, { glErrors });
    await aside(page).getByRole("button", { name: "Reset", exact: true }).click().catch(() => {});
  }

  if (want("keys")) {
    await tool(page, "Clips");
    await page.mouse.click(750, 500);
    await seek(page, 4.5);
    await page.keyboard.press("s");
    await wait(200);
    const afterS = (await clipIds(page)).length;
    await page.keyboard.press("ControlOrMeta+z");
    await wait(200);
    const afterUndo = (await clipIds(page)).length;
    await page.keyboard.press("ControlOrMeta+b");
    await wait(200);
    const afterB = (await clipIds(page)).length;
    await page.keyboard.press("ControlOrMeta+z");
    await wait(200);
    const afterUndo2 = (await clipIds(page)).length;
    record("keys.split", afterS === 2 && afterUndo === 1 && afterB === 2 && afterUndo2 === 1, { afterS, afterUndo, afterB, afterUndo2 });
  }

  if (want("dnd")) {
    await addClip(page, fx("sync_25s.mp4"));
    const before = await clipIds(page);
    // Both blocks must be on screen for the pointer to reach them.
    await page.getByTitle("Fit timeline").click();
    await wait(200);
    const blocks = page.locator("[data-clip]");
    const first = await blocks.nth(0).boundingBox();
    const second = await blocks.nth(1).boundingBox();
    await page.mouse.move(second.x + second.width / 2, second.y + second.height / 2);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width / 2 + 12, second.y + second.height / 2, { steps: 3 });
    await page.mouse.move(first.x + 4, first.y + second.height / 2, { steps: 12 });
    await wait(100);
    const indicator = await page.locator("[data-drop-indicator]").count();
    await page.mouse.up();
    await wait(300);
    const after = await clipIds(page);
    await page.keyboard.press("ControlOrMeta+z");
    await wait(200);
    const undone = await clipIds(page);
    record("dnd.reorder", indicator === 1 && after[0] === before[1] && after[1] === before[0] && undone.join() === before.join(), { before, after, undone, indicator });
    // Leave the face clip first for the matte test.
    await page.evaluate(() => {
      const s = window.__nocap.useEditor.getState();
      s.update((p) => void (p.clips = p.clips.filter((c) => c.name.includes("face"))));
    });
    await wait(300);
  }

  if (want("dblclick")) {
    await tool(page, "Text");
    await aside(page).getByRole("button", { name: "Title" }).click();
    await page.waitForSelector("text=Overlay", { timeout: 5000 });
    await wait(400);
    const box = await page.locator("main .border-brand-400").first().boundingBox();
    await tool(page, "Clips");
    await wait(200);
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await wait(400);
    const focus = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, editor: el?.getAttribute("data-content-editor"), selStart: el?.selectionStart, selEnd: el?.selectionEnd, len: el?.value?.length };
    });
    const toolNow = (await store(page)).tool;
    record("dblclick.editsTitle", toolNow === "text" && focus.editor === "text" && focus.selStart === 0 && focus.selEnd === focus.len && focus.len > 0, { toolNow, focus });
    await page.keyboard.press("Escape");
  }

  if (want("matte")) {
    await tool(page, "Picture");
    await aside(page).locator('input[type="file"][accept="image/*"]').first().setInputFiles(fx("photo.jpg"));
    await page.waitForFunction(() => window.__nocap.useEditor.getState().project.overlays.some((o) => o.kind === "image"), null, { timeout: 15_000 });
    const before = (await store(page)).project.overlays.find((o) => o.kind === "image");
    const t1 = Date.now();
    await aside(page).getByRole("button", { name: "Remove background" }).click();
    await page.waitForFunction(
      (assetId) => {
        const s = window.__nocap.useEditor.getState();
        const ov = s.project.overlays.find((o) => o.kind === "image");
        return ov.assetId !== assetId || /stalled|Unsupported|failed|Error/i.test(document.querySelector("aside")?.innerText ?? "");
      },
      before.assetId,
      { timeout: 6 * 60_000 },
    );
    const after = (await store(page)).project.overlays.find((o) => o.kind === "image");
    const asset = after.assetId !== before.assetId ? await inspectAsset(page, after.assetId) : null;
    const device = await page.evaluate(() => localStorage.getItem("reelflow.mlDevice.matte"));
    const panelText = (await aside(page).innerText()).match(/Runs on[^\n]*/)?.[0];
    record("matte.sticker", !!asset && asset.type === "image/png" && asset.transparent > 0 && asset.opaque >= 0, { ms: Date.now() - t1, asset, device, panelText, gpuOff });

    await tool(page, "Trim");
    await page.locator("[data-clip]").first().click({ position: { x: 40, y: 30 } });
    await aside(page).getByRole("button", { name: /More options/ }).click();
    await aside(page).getByLabel("Mask rate").selectOption("4");
    const t2 = Date.now();
    await aside(page).getByRole("button", { name: "Cut out the subject" }).click();
    await page.waitForFunction(() => window.__nocap.useEditor.getState().project.clips[0]?.matte || /stalled|Unsupported|failed|Error/i.test(document.querySelector("aside")?.innerText ?? ""), null, { timeout: 10 * 60_000 });
    const clip = (await store(page)).project.clips[0];
    const matteAsset = clip.matte ? await inspectAsset(page, clip.matte.assetId) : null;
    record("matte.clip", !!clip.matte && Math.abs(clip.matte.count - 36) <= 1 && clip.matte.fps === 4, { ms: Date.now() - t2, matte: clip.matte, asset: matteAsset, device: await page.evaluate(() => localStorage.getItem("reelflow.mlDevice.matte")), gpuOff });
  }

  const saved = await readProject(page, id);
  log("project saved with", saved.clips.length, "clips,", saved.overlays.length, "overlays");
  const unexpected = errors.filter((e) => !/favicon/.test(e));
  record("editor.console", unexpected.length === 0, { errors: unexpected.slice(0, 10) });
  await context.close();
}

// ---------------------------------------------------------------------------
// export: engine usage, splice sync, validation
// ---------------------------------------------------------------------------
function validate(file) {
  const check = JSON.parse(execFileSync("python3", [join(here, "validators", "mp4check.py"), file], { maxBuffer: 1 << 26 }).toString());
  const sync = JSON.parse(execFileSync("node", [join(here, "validators", "syncmeasure.mjs"), file], { maxBuffer: 1 << 28 }).toString());
  const decode = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }).toString().trim();
  const frames = Number(execFileSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", file]).toString().trim());
  const bframes = Number(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=has_b_frames", "-of", "csv=p=0", file]).toString().trim());
  const tracks = Object.fromEntries(Object.entries(check.tracks).map(([k, v]) => [k, { kind: v.kind, contiguous: v.contiguous, gaps: v.gaps, frags: v.fragCount }]));
  return { fragmented: check.fragmented, moofs: check.moofCount, elst: check.elst, tracks, offsets: sync.pairs.map((p) => p.offsetMs), meanOffsetMs: sync.meanOffsetMs, driftMs: sync.driftMs, frames, bframes, decode };
}

async function runExport(page, console_, { label, resolution, segments, renderMode, preset = "ultrafast" }) {
  await tool(page, "Export");
  await page.getByLabel("Resolution").selectOption(resolution);
  await page.getByLabel("Encoder speed").selectOption(preset);
  await page.getByLabel("Segment length").selectOption(String(segments));
  await page.getByLabel("Render path").selectOption(renderMode);
  await setOff(page, /Burn in captions/);
  await setOff(page, /Also save/);
  await setOff(page, /Stream to a file/);
  const summary = (await aside(page).innerText()).match(/of video[^\n]*/)?.[0];
  // Progress messages with timestamps, observed from inside the page.
  await page.evaluate(() => {
    window.__progress = [];
    const el = document.querySelector("aside");
    let last = "";
    const tick = () => {
      const m = el.innerText.match(/(Loading[^\n]*|Preparing[^\n]*|Rendering[^\n]*|Encoding[^\n]*|Writing[^\n]*|Finishing[^\n]*|Rendered in[^\n]*|stalled[^\n]*|exited with code[^\n]*)/);
      if (m && m[0] !== last) {
        last = m[0];
        window.__progress.push({ t: performance.now(), m: m[0].slice(0, 120) });
      }
    };
    window.__progressTimer = setInterval(tick, 50);
  });
  const logStart = console_.length;
  const downloads = [];
  const onDownload = (d) => downloads.push(d);
  page.on("download", onDownload);
  const started = Date.now();
  const startedPerf = await page.evaluate(() => performance.now());
  await page.getByRole("button", { name: "Export MP4" }).click();
  await page.waitForFunction(() => /Rendered in|exited with code|cancelled|failed|Error/i.test(document.querySelector("aside")?.innerText ?? ""), null, { timeout: 10 * 60_000 });
  const elapsed = (Date.now() - started) / 1000;
  await wait(1200);
  page.off("download", onDownload);
  const progress = await page.evaluate(() => {
    clearInterval(window.__progressTimer);
    return window.__progress;
  });
  const timeline = progress.map((p) => ({ dt: +((p.t - startedPerf) / 1000).toFixed(2), m: p.m }));
  const ff = console_.slice(logStart).filter((l) => l.text.startsWith("[ffmpeg]")).map((l) => ({ dt: +((l.t - started) / 1000).toFixed(2), m: l.text.slice(9, 140) }));
  const engineLine = (await aside(page).innerText()).match(/(Encoding with|Last export used|Multi-threaded|Single-threaded)[^\n]*/)?.[0];
  const mp4 = downloads.find((d) => d.suggestedFilename().endsWith(".mp4"));
  const file = mp4 ? join(outDir, `${label}.mp4`) : null;
  if (mp4) await mp4.saveAs(file);
  const panelTail = (await aside(page).innerText()).match(/Rendered in[^\n]*|exited with code[^\n]*|Error[^\n]*/)?.[0];
  return { label, elapsed, timeline, ff, engineLine, file, panelTail, summary };
}

function engineTiming(run) {
  const loaded = run.ff.filter((l) => /^loaded/.test(l.m));
  const mtLoaded = loaded.find((l) => /multithreaded: true|multithreaded:true/.test(l.m));
  const firstProbeLine = mtLoaded ? run.ff.find((l) => l.dt >= mtLoaded.dt && /Stream #0:0/.test(l.m)) : null;
  const preparing = run.timeline.find((p) => /^Preparing/.test(p.m));
  const encoding = run.timeline.find((p) => /^Encoding/.test(p.m));
  return {
    loads: loaded.map((l) => l.m.slice(0, 80)),
    mtLoadedAt: mtLoaded?.dt ?? null,
    probeOutputAt: firstProbeLine?.dt ?? null,
    preparingAt: preparing?.dt ?? null,
    encodingAt: encoding?.dt ?? null,
    stalled: run.timeline.some((p) => /stalled/.test(p.m)),
  };
}

async function testExport() {
  const { context, page, console_, errors } = await makeContext();
  await openProjectWith(page, fx("sync_25s.mp4"));
  const runs = {};
  for (const cfg of [
    { label: "filters-10s", resolution: "720", segments: 10, renderMode: "filters" },
    { label: "compositor-10s", resolution: "720", segments: 10, renderMode: "compositor" },
  ]) {
    const run = await runExport(page, console_, cfg);
    runs[cfg.label] = run;
    const timing = engineTiming(run);
    const val = run.file ? validate(run.file) : null;
    const isolated = await page.evaluate(() => crossOriginIsolated);
    // The engine may already be loaded from an earlier export (no new "loaded"
    // line), and preparation can finish between two progress samples; both are
    // fine as long as nothing stalled and encoding starts promptly after the click.
    const probeOk = timing.mtLoadedAt === null || (timing.probeOutputAt !== null && timing.probeOutputAt - timing.mtLoadedAt <= 1);
    const engineOk = !isolated || (probeOk && !timing.stalled && /multi-threaded/.test(run.engineLine ?? ""));
    const promptOk = timing.encodingAt !== null && timing.encodingAt - (timing.preparingAt ?? 0) <= 5;
    record(`export.${cfg.label}.engine`, engineOk && promptOk, { isolated, timing, engineLine: run.engineLine, elapsed: run.elapsed, panel: run.panelTail, summary: run.summary });
    const syncOk = !!val && val.fragmented && val.offsets.length === 8 && val.offsets.every((o) => Math.abs(o) <= 1) && Object.values(val.tracks).every((t) => t.contiguous) && val.frames === 750 && val.bframes === 0 && val.decode === "";
    record(`export.${cfg.label}.file`, syncOk, val ?? { error: "no download", panel: run.panelTail });
  }
  const unexpected = errors.filter((e) => !/favicon/.test(e));
  record("export.console", unexpected.length === 0, { errors: unexpected.slice(0, 10) });
  await context.close();
  return runs;
}

async function testSpeed() {
  const timings = {};
  for (const singleThread of [false, true]) {
    const { context, page, console_ } = await makeContext({ singleThread });
    await openProjectWith(page, fx("sync_25s.mp4"));
    const run = await runExport(page, console_, { label: singleThread ? "speed-st" : "speed-mt", resolution: "1080", segments: 0, renderMode: "filters" });
    const encoding = run.timeline.find((p) => /^Encoding/.test(p.m));
    const done = run.timeline.find((p) => /^Rendered in|^Finishing/.test(p.m));
    timings[singleThread ? "st" : "mt"] = { elapsed: run.elapsed, encodeSeconds: encoding && done ? +(done.dt - encoding.dt).toFixed(2) : null, engineLine: run.engineLine, panel: run.panelTail };
    await context.close();
  }
  const ratio = timings.st.encodeSeconds && timings.mt.encodeSeconds ? +(timings.st.encodeSeconds / timings.mt.encodeSeconds).toFixed(2) : null;
  record("speed.mtVsSt", ratio !== null && ratio >= 2, { ...timings, ratio });
}

let failed = false;
try {
  if (want("pages")) await testPages();
  if (["lut", "keys", "dnd", "dblclick", "matte"].some(want)) await testEditor();
  if (want("export")) await testExport();
  if (want("speed")) await testSpeed();
} catch (e) {
  failed = true;
  console.error("QA CRASHED:", e);
} finally {
  await browser.close();
  server?.kill();
  const failures = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failures.length}/${results.length} checks passed${failures.length ? `; failed: ${failures.map((f) => f.id).join(", ")}` : ""}`);
  process.exit(failed || failures.length ? 1 : 0);
}
