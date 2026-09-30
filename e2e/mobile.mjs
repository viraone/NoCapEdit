// End-to-end test of the mobile-lite flow (/m/): pick the speech fixture,
// wait for Whisper (tiny, WASM/WebGPU) to produce captions, export with
// WebCodecs, download the MP4 and validate it with ffprobe.
//
//   node e2e/mobile.mjs            # Chromium
//   BROWSER=webkit node e2e/mobile.mjs
//   AUDIO=ffmpeg|webaudio|webcodecs node e2e/mobile.mjs   # force one audio-extraction path
//   EXPORT=fast|realtime node e2e/mobile.mjs   # force one exporter (default: fast, falling back to realtime)
//   STREAM=1 node e2e/mobile.mjs       # force the long-clip streaming export
//   CLIP=path/to/clip.mp4 node e2e/mobile.mjs   # use another input clip
//   FRAME=9:16 node e2e/mobile.mjs     # reframe to a shape, drag the video, check the export's aspect
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
// The mobile flow should not need the 32 MB ffmpeg core any more; say so if it loads.
page.on("request", (r) => {
  if (r.url().includes("ffmpeg-core.wasm")) console.log("[ffmpeg core requested]", r.method());
});

const t0 = Date.now();
const lap = (label) => console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${label}`);

try {
  const query = new URLSearchParams();
  if (process.env.AUDIO) query.set("audio", process.env.AUDIO);
  if (process.env.EXPORT) query.set("export", process.env.EXPORT);
  if (process.env.FX) query.set("fx", process.env.FX);
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

  // Reframe (FRAME=9:16): choose the shape and drag the video sideways.
  if (process.env.FRAME) {
    await page.getByRole("tab", { name: /frame/i }).click();
    await page.getByRole("button", { name: `Frame ${process.env.FRAME}` }).click();
    await page.waitForTimeout(300);
    const box = await page.locator("video").first().evaluate((v) => v.parentElement.getBoundingClientRect().toJSON());
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 60, box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(outDir, "mobile-3b-frame.png") });
    lap(`reframed to ${process.env.FRAME} (${Math.round(box.width)}×${Math.round(box.height)} preview)`);
    if (process.env.FRAME === "9:16" && !process.env.CLIP) {
      // A tall window on the landscape fixture spans its full height: a
      // vertical drag can't move it, and the editor must say why.
      await page.getByText(/drag left or right · zoom in to move up and down/i).waitFor({ timeout: 2_000 });
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 50, { steps: 5 });
      await page.getByText(/zoom in to move up and down/i).first().waitFor({ timeout: 2_000 });
      await page.mouse.up();
      await page.screenshot({ path: join(outDir, "mobile-3c-locked-hint.png") });
      lap("locked-axis hint shown for a vertical drag");
    }
  }

  // Pick a different look, then export.
  await page.getByRole("tab", { name: /looks/i }).click();
  await page.getByRole("button", { name: /^beast$/i }).click();
  await exportBtn.click();
  // The fast exporter can finish a short clip before this screen is even
  // painted, so seeing it is best-effort.
  await page.getByText(/rendering on your phone/i).waitFor({ timeout: 5_000 }).catch(() => undefined);
  lap("exporting");
  await page.screenshot({ path: join(outDir, "mobile-4-exporting.png") }).catch(() => undefined);

  const saveBtn = page.getByRole("button", { name: /save to photos|download mp4/i });
  await saveBtn.waitFor({ timeout: 5 * 60_000 });
  lap("export done");
  await page.screenshot({ path: join(outDir, "mobile-5-done.png") });
  const summary = await page.getByText(/\d+(\.\d+)? MB/).first().innerText();
  const engineUsed = await page.locator("[data-export-engine]").getAttribute("data-export-engine");
  const timerText = await page.locator("[data-export-timer]").innerText().catch(() => "");
  console.log("result:", summary, "· engine:", engineUsed);
  if (timerText) console.log("timer:", timerText.replace(/\s*\n\s*/g, " | "));
  if (process.env.EXPORT && engineUsed !== process.env.EXPORT) throw new Error(`Expected the ${process.env.EXPORT} exporter, got ${engineUsed}`);

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

  const probeStreams = (file) =>
    JSON.parse(
      execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration,nb_read_frames", "-of", "json", file]).toString(),
    ).streams;
  const streams = probeStreams(outFile);
  console.log("streams:", JSON.stringify(streams));
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  if (!video || video.codec_name !== "h264") throw new Error("Expected an H.264 video stream");
  if (!audio) console.log("WARNING: no audio stream in export");
  else if (audio.codec_name !== "aac") throw new Error(`Expected AAC audio, got ${audio.codec_name}`);
  if (process.env.FX !== "resize-only") {
    // Every decoded frame must come out again (or, above 32 fps, one per
    // 30 fps slot) and the clip must keep its length: the exporter hands
    // GPU frames back one call late and has to flush the last one.
    const source = probeStreams(clip).find((s) => s.codec_type === "video");
    const [num, den] = source.r_frame_rate.split("/").map(Number);
    const sourceFps = num / den;
    const sourceFrames = Number(source.nb_read_frames);
    const gotFrames = Number(video.nb_read_frames);
    const wantFrames = sourceFps > 32 ? Math.round((sourceFrames * 30) / sourceFps) : sourceFrames;
    const slack = sourceFps > 32 ? 3 : 0;
    console.log(`frames: ${gotFrames} (source ${sourceFrames} @ ${sourceFps.toFixed(2)} fps) · duration ${video.duration}s (source ${source.duration}s)`);
    if (Math.abs(gotFrames - wantFrames) > slack) throw new Error(`Export has ${gotFrames} frames, expected ${wantFrames}${slack ? ` ± ${slack}` : ""}`);
    if (Math.abs(Number(video.duration) - Number(source.duration)) > 1 / Math.min(30, sourceFps) + 0.01) {
      throw new Error(`Export is ${video.duration}s long, source is ${source.duration}s`);
    }
  }
  if (process.env.FRAME) {
    const [rw, rh] = process.env.FRAME.split(":").map(Number);
    const got = video.width / video.height;
    if (Math.abs(got - rw / rh) > 0.02) throw new Error(`Expected a ${process.env.FRAME} export, got ${video.width}×${video.height}`);
    // The shape alone can't tell a crop from a squeeze (WebKit once drew the
    // whole frame squashed into the new shape). The speech fixture's left
    // edge is a red bar; a real centre crop dragged left never shows it.
    if (!process.env.CLIP) {
      const px = execFileSync("ffmpeg", ["-v", "error", "-ss", "3", "-i", outFile, "-frames:v", "1", "-vf", "crop=4:4:6:ih/2", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
      const [r, g, b] = [px[0], px[1], px[2]];
      if (r > 180 && g < 90 && b < 90) throw new Error(`Reframed export looks squeezed, not cropped (left edge is red: ${r},${g},${b})`);
      if (r + g + b < 60) throw new Error(`Reframed export is black at the left edge (${r},${g},${b}) — dead compositor?`);
      console.log(`crop check: left edge rgb(${r},${g},${b})`);
    }
  }
  if (!process.env.FRAME && !process.env.CLIP && process.env.FX !== "resize-only" && process.env.FX !== "passthrough") {
    // Colour fidelity, end to end (decoder → compositor → encoder → the
    // MP4's colour tags): the frame at 2 s, as a player would show it, must
    // match the fixture's on its six colour bars (flat 8×8 patches in the
    // top half, clear of the captions). A wrong range, or a wrong colr
    // atom, is off by 50+ on a channel; a BT.601/709 mix-up by about 25.
    const frame = (file) => execFileSync("ffmpeg", ["-v", "error", "-ss", "2", "-i", file, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
    const a = frame(outFile);
    const b = frame(clip);
    if (a.length !== b.length) throw new Error(`Export frame size differs from the source (${a.length} vs ${b.length} bytes)`);
    const width = video.width;
    const patch = (buf, cx, cy) => {
      const sum = [0, 0, 0];
      for (let y = cy - 4; y < cy + 4; y++) for (let x = cx - 4; x < cx + 4; x++) for (let c = 0; c < 3; c++) sum[c] += buf[(y * width + x) * 3 + c];
      return sum.map((v) => Math.round(v / 64));
    };
    let worst = 0;
    const report = [];
    for (const cx of [50, 160, 265, 370, 480, 590]) {
      const got = patch(a, cx, 120);
      const want = patch(b, cx, 120);
      worst = Math.max(worst, ...got.map((v, i) => Math.abs(v - want[i])));
      report.push(`(${got.join(",")})`);
    }
    // The GPU routes make the YUV themselves. Canvas routes leave that to the
    // browser, and Chrome converts with BT.601 while labelling it BT.709.
    const limit = /gpu\//.test(timerText) ? 16 : 32;
    console.log(`colour check: bars ${report.join(" ")} · worst channel error ${worst} (limit ${limit})`);
    if (worst > limit) throw new Error(`Export colours drift from the source: worst channel error ${worst} (limit ${limit})`);
    // Timing: the same frame must sit at the same timestamp. The pattern
    // moves, so a picture that is one frame off has ~0.3% of the top half
    // changed by more than 40 levels; an aligned export has none.
    let moved = 0;
    const half = (width * (video.height / 2)) * 3;
    for (let i = 0; i < half; i += 3) {
      const la = (a[i] * 299 + a[i + 1] * 587 + a[i + 2] * 114) / 1000;
      const lb = (b[i] * 299 + b[i + 1] * 587 + b[i + 2] * 114) / 1000;
      if (Math.abs(la - lb) > 40) moved += 1;
    }
    const movedPct = (moved / (half / 3)) * 100;
    console.log(`timing check: ${movedPct.toFixed(2)}% of the top half differs from the source frame at 2 s (limit 0.1%)`);
    if (movedPct > 0.1) throw new Error(`Export frame at 2 s does not match the source frame at 2 s (${movedPct.toFixed(2)}% moved) — frames shifted?`);
  }
  console.log("MOBILE E2E OK");
} finally {
  await browser.close();
  server?.kill();
}
