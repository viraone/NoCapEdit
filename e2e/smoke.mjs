// End-to-end smoke test: import two clips, add a crossfade, generate captions
// with Whisper (WASM), export a segmented MP4, and validate it with ffprobe.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const project = process.argv[2] ?? join(here, "..");
const port = 4173;
const clip = join(here, "fixtures", "test-speech.mp4");
const outDir = join(here, "results");
mkdirSync(outDir, { recursive: true });

// E2E_URL=https://host/path/ runs against a deployed site instead of the local build.
const remote = process.env.E2E_URL?.replace(/\/?$/, "/");
const baseUrl = remote ?? `http://localhost:${port}/`;
const server = remote ? null : spawn(process.execPath, [join(here, "serve.mjs"), join(project, "out"), String(port)], { stdio: "inherit" });
if (!remote) await new Promise((r) => setTimeout(r, 800));

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await chromium.launch({
  headless: true,
  args: ["--use-angle=swiftshader", "--enable-unsafe-webgpu", "--autoplay-policy=no-user-gesture-required", "--disable-features=BlockInsecurePrivateNetworkRequests"],
});
const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1500, height: 950 } });
await context.addInitScript(() => {
  localStorage.setItem("reelflow.debug", "1");
  if (new URLSearchParams(location.search).has("st")) localStorage.setItem("reelflow.singleThread", "1");
});
if (process.env.SINGLE_THREAD) await context.addInitScript(() => localStorage.setItem("reelflow.singleThread", "1"));
const page = await context.newPage();
const errors = [];
const ffmpegLog = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  const text = m.text();
  if (text.startsWith("[ffmpeg]")) {
    ffmpegLog.push(text.slice(9, 400));
    if (ffmpegLog.length > 400) ffmpegLog.shift();
    return;
  }
  if (m.type() === "error" || m.type() === "warning") errors.push(`console.${m.type()}: ${text.slice(0, 300)}`);
});

let failed = false;
try {
  await page.goto(baseUrl);
  await page.waitForSelector("text=ReelFlow Web");
  // Hosts without COOP/COEP headers rely on the service worker, which reloads once.
  await page.waitForFunction(() => crossOriginIsolated || performance.now() > 8000, null, { timeout: 15000 }).catch(() => {});
  const isolated = await page.evaluate(() => crossOriginIsolated);
  log("crossOriginIsolated:", isolated);

  // Quick import two copies of the clip -> new project -> editor.
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles([clip, clip]);
  await page.waitForURL(/\/editor\/?\?id=/, { timeout: 120_000 });
  await page.waitForSelector("text=2 clips", { timeout: 60_000 });
  log("editor opened with 2 clips");

  const rail = page.getByRole("navigation", { name: "Tools" });
  // Crossfade between the clips.
  await rail.getByRole("button", { name: "Trim" }).click();
  await page.getByLabel("Type").selectOption("fade");
  await rail.getByRole("button", { name: "Clips" }).click();

  // Captions with Whisper tiny on WASM.
  await rail.getByRole("button", { name: "Subtitles" }).click();
  await page.getByLabel("Model").selectOption({ index: 0 });
  await page.getByLabel("Compute").selectOption("wasm");
  await page.getByRole("button", { name: "Generate captions" }).click();
  const started = Date.now();
  await page.waitForFunction(() => /Cues \([1-9]\d*\)/i.test(document.body.innerText) || /Speech recognition error|failed|Error:/i.test(document.body.innerText), null, { timeout: 8 * 60_000 });
  const cueText = await page.locator("[data-cue] input").first().inputValue();
  const cueCount = await page.evaluate(() => Number(document.body.innerText.match(/Cues \((\d+)\)/i)?.[1] ?? 0));
  if (!cueCount) throw new Error(`no cues; panel says: ${await page.locator("aside").innerText()}`);
  log(`captions: ${cueCount} cues in ${Math.round((Date.now() - started) / 1000)}s, first: "${cueText}"`);
  const transcript = await page.evaluate(() => Array.from(document.querySelectorAll("[data-cue] input")).map((i) => i.value).join(" "));
  log("transcript:", transcript);
  if (!/reel ?flow|caption|device/i.test(transcript)) throw new Error("Transcript does not contain expected words");

  // Export: 720p, fastest, 10 s segments (=> 2 fragmented segments), no disk streaming.
  await rail.getByRole("button", { name: "Export" }).click();
  await page.getByLabel("Resolution").selectOption("720");
  await page.getByLabel("Encoder speed").selectOption("ultrafast");
  await page.getByLabel("Segment length").selectOption("10");
  const diskToggle = page.getByRole("switch", { name: /Stream to a file/ });
  if ((await diskToggle.getAttribute("aria-checked")) === "true") await diskToggle.click();
  const downloads = [];
  page.on("download", (d) => downloads.push(d));
  const t0 = Date.now();
  await page.getByRole("button", { name: "Export MP4" }).click();
  await page.waitForFunction(() => /Rendered in|exited with code|cancelled|failed|Error/i.test(document.querySelector("aside")?.innerText ?? ""), null, { timeout: 5 * 60_000 });
  if (!/Rendered in/.test(await page.locator("aside").innerText())) throw new Error(`export failed: ${(await page.locator("aside").innerText()).slice(-600)}`);
  log(`export finished in ${Math.round((Date.now() - t0) / 1000)}s`);
  await page.waitForFunction(() => document.body.innerText.includes("Rendered in"));
  await new Promise((r) => setTimeout(r, 1500));
  const mp4 = downloads.find((d) => d.suggestedFilename().endsWith(".mp4"));
  if (!mp4) throw new Error(`no mp4 download; got ${downloads.map((d) => d.suggestedFilename()).join(", ")}`);
  const outFile = join(outDir, "export.mp4");
  await mp4.saveAs(outFile);
  for (const d of downloads) if (d !== mp4) await d.saveAs(join(outDir, d.suggestedFilename()));
  log("downloads:", downloads.map((d) => d.suggestedFilename()).join(", "));

  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height,r_frame_rate", "-of", "json", outFile]).toString();
  log("ffprobe:", probe.replace(/\s+/g, " "));
  const info = JSON.parse(probe);
  const video = info.streams.find((s) => s.codec_type === "video");
  const audio = info.streams.find((s) => s.codec_type === "audio");
  const dur = Number(info.format.duration);
  if (!video || video.codec_name !== "h264" || video.width !== 720 || video.height !== 1280) throw new Error("unexpected video stream");
  if (!audio || audio.codec_name !== "aac") throw new Error("unexpected audio stream");
  if (dur < 15 || dur > 16.5) throw new Error(`unexpected duration ${dur}`);
  const decode = execFileSync("ffmpeg", ["-v", "error", "-i", outFile, "-f", "null", "-"]).toString();
  if (decode.trim()) throw new Error(`decode errors: ${decode}`);
  const frames = execFileSync("ffprobe", ["-v", "error", "-count_packets", "-select_streams", "v:0", "-show_entries", "stream=nb_read_packets", "-of", "csv=p=0", outFile]).toString().trim();
  log(`decoded cleanly; ${frames} video packets, duration ${dur.toFixed(2)}s`);
  await page.screenshot({ path: join(outDir, "editor.png") });
  log("E2E PASSED");
} catch (e) {
  failed = true;
  console.error("E2E FAILED:", e.message);
  await page.screenshot({ path: join(outDir, "failure.png") }).catch(() => {});
} finally {
  if (errors.length) console.log("browser messages:\n  " + errors.slice(0, 25).join("\n  "));
  if (failed && ffmpegLog.length) console.log("ffmpeg log (last 60 lines):\n  " + ffmpegLog.slice(-60).join("\n  "));
  await browser.close();
  server?.kill();
  process.exit(failed ? 1 : 0);
}
