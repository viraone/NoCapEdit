// Captures the start screen and the editor (Trim tool) for a visual check.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const port = 4174;
const out = join(here, "results");
mkdirSync(out, { recursive: true });
const server = spawn(process.execPath, [join(here, "serve.mjs"), join(here, "..", "out"), String(port)], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1760, height: 990 }, deviceScaleFactor: 1 });
try {
  await page.goto(`http://localhost:${port}/`);
  await page.waitForSelector("text=NoCap Edit");
  await page.screenshot({ path: join(out, "shot-start.png") });
  await page.locator('input[type="file"][accept^="video"]').first().setInputFiles([join(here, "fixtures", "test-speech.mp4")]);
  await page.waitForURL(/\/editor\/?\?id=/, { timeout: 60_000 });
  await page.waitForSelector("text=1 clips", { timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Trim" }).click();
  await new Promise((r) => setTimeout(r, 800));
  await page.screenshot({ path: join(out, "shot-editor-trim.png") });
  await page.getByRole("navigation", { name: "Tools" }).getByRole("button", { name: "Subtitles" }).click();
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: join(out, "shot-editor-subtitles.png") });
  console.log("screenshots written to", out);
} catch (e) {
  console.error("screenshot failed:", e.message);
  await page.screenshot({ path: join(out, "shot-failure.png") }).catch(() => {});
} finally {
  await browser.close();
  server.kill();
}
