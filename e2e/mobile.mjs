// End-to-end test of the mobile-lite flow (/m/): pick the speech fixture,
// wait for Whisper (tiny, WASM/WebGPU) to produce captions, export with
// WebCodecs, download the MP4 and validate it with ffprobe.
//
//   node e2e/mobile.mjs            # Chromium
//   BROWSER=webkit node e2e/mobile.mjs
//   AUDIO=ffmpeg node e2e/mobile.mjs   # force the iOS audio-extraction fallback
//   STREAM=1 node e2e/mobile.mjs       # force the long-clip streaming export
//   CLIP=path/to/clip.mp4 node e2e/mobile.mjs   # use another input clip
//   E2E_URL=https://nocapedit.com/ node e2e/mobile.mjs   # against a deployment
import { chromium, webkit } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const project = join(here, "..");
const clip = process.env.CLIP ? join(process.cwd(), process.env.CLIP) : join(here, "fixtures", "test-speech.mp4");
const port = 4174;
const remote = process.env.E2E_URL;
const baseUrl = remote ?? `http://localhost:${port}/`;
const engine = process.env.BROWSER === "webkit" ? webkit : chromium;
const outDir = join(here, "results");
mkdirSync(outDir, { recursive: true });

const server = remote ? null : spawn(process.execPath, [join(here, "serve.mjs"), join(project, "out"), String(port)], { stdio: "inherit" });
await new Promise((r) => setTimeout(r, 800));

const browser = await engine.launch({
  headless: true,
  args: engine === chromium ? ["--use-angle=swiftshader", "--enable-unsafe-webgpu", "--autoplay-policy=no-user-gesture-required"] : [],
});
const context = await browser.newContext({
  acceptDownloads: true,
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: engine === chromium,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") console.log(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

const t0 = Date.now();
const lap = (label) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);

try {
  const query = new URLSearchParams();
  if (process.env.AUDIO === "ffmpeg") query.set("audio", "ffmpeg");
  if (process.env.STREAM === "1") query.set("stream", "1");
  if (process.env.ASR) query.set("asr", process.env.ASR);
  if (process.env.THREADS) query.set("threads", process.env.THREADS);
  const qs = query.toString();
  await page.goto(new URL(`m/${qs ? `?${qs}` : ""}`, baseUrl).toString());
  await page.getByRole("button", { name: /choose a video/i }).waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(outDir, "mobile-1-pick.png") });
  lap("pick screen");

  const support = await page.evaluate(() => ({
    videoEncoder: typeof VideoEncoder !== "undefined",
    audioEncoder: typeof AudioEncoder !== "undefined",
    rvfc: "requestVideoFrameCallback" in HTMLVideoElement.prototype,
    share: typeof navigator.canShare === "function",
  }));
  console.log("support:", JSON.stringify(support));

  await page.locator('input[type="file"][accept="video/*"]').setInputFiles(clip);
  await page.getByText(/making captions/i).waitFor({ timeout: 30_000 });
  lap("analysing");
  await page.screenshot({ path: join(outDir, "mobile-2-analysing.png") });

  // Whisper tiny: one-time model download + transcription.
  const exportBtn = page.getByRole("button", { name: /export video/i });
  await exportBtn.waitFor({ timeout: 8 * 60_000 });
  lap("captions ready");
  await page.getByRole("tab", { name: /text/i }).click();
  await page.waitForTimeout(400);
  const selectedTab = await page.locator('[role="tab"][aria-selected="true"]').last().innerText();
  if (!/text/i.test(selectedTab)) throw new Error(`Expected the Text tab to be selected, got "${selectedTab}"`);
  const cueCount = await page.locator("ul li input").count();
  const cueTimes = await page.locator("ul li button").allInnerTexts();
  const cueTexts = await page.locator("ul li input").evaluateAll((els) => els.map((e) => e.value));
  console.log("cues:", cueCount, "first:", cueTimes.slice(0, 4).join(" "), "… last:", cueTimes.slice(-3).join(" "));
  console.log("text:", cueTexts.slice(0, 6).join(" | "));
  if (cueCount === 0) throw new Error("No captions produced");
  await page.screenshot({ path: join(outDir, "mobile-3-style.png") });

  // Playback preview: press play and make sure the scrubber moves (iOS
  // Safari once froze it — frame callbacks stop after a paused seek).
  await page.getByRole("button", { name: "Play" }).first().click();
  await page.waitForTimeout(1500);
  const shown = await page.locator("input[aria-label='Scrub']").inputValue();
  if (!(Number(shown) > 0.5)) throw new Error(`Preview scrubber did not advance (at ${shown}s)`);
  await page.getByRole("button", { name: "Pause" }).first().click();
  lap(`preview plays (scrubber at ${Number(shown).toFixed(1)}s)`);

  // Pick a different look, then export.
  await page.getByRole("tab", { name: /looks/i }).click();
  await page.getByRole("button", { name: /^beast$/i }).click();
  await exportBtn.click();
  await page.getByText(/rendering in real time/i).waitFor({ timeout: 30_000 });
  lap("exporting");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(outDir, "mobile-4-exporting.png") });

  const saveBtn = page.getByRole("button", { name: /save to photos|download mp4/i });
  await saveBtn.waitFor({ timeout: 5 * 60_000 });
  lap("export done");
  await page.screenshot({ path: join(outDir, "mobile-5-done.png") });
  const summary = await page.getByText(/\d+(\.\d+)? MB/).first().innerText();
  console.log("result:", summary);

  const outFile = join(outDir, `mobile-export-${engine === chromium ? "chromium" : "webkit"}.mp4`);
  if (engine === chromium) {
    // Chromium headless has no share sheet, so the button falls back to a download.
    const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), saveBtn.click()]);
    await download.saveAs(outFile);
  } else {
    // WebKit advertises navigator.share but headless can't show the sheet;
    // pull the finished blob straight out of the result <video> instead.
    const b64 = await page.evaluate(async () => {
      const v = document.querySelector("video[controls]");
      const buf = await (await fetch(v.src)).arrayBuffer();
      let bin = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(outFile, Buffer.from(b64, "base64"));
  }
  lap(`saved ${outFile}`);

  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration", "-of", "json", outFile]).toString();
  const streams = JSON.parse(probe).streams;
  console.log("streams:", JSON.stringify(streams));
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video || video.codec_name !== "h264") throw new Error("Expected an H.264 video stream");
  if (!audio) console.log("WARNING: no audio stream in export");
  else if (audio.codec_name !== "aac") throw new Error(`Expected AAC audio, got ${audio.codec_name}`);
  console.log("MOBILE E2E OK");
} finally {
  await browser.close();
  server?.kill();
}
