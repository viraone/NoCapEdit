/**
 * Draws one frame of the documentary on a 2D canvas: dark background, a slowly drifting glow,
 * and the scene's heading and lines easing in as the narrator reaches them. Everything is a
 * pure function of the time `t`, so the encoder can ask for any frame in any order.
 */
import type { DocScene, DocScript } from "./script";
import { clamp01, lineRevealTimes, reveal, sceneAt, type FilmTimeline } from "./timeline";

const BG = "#0b0d12";
const ACCENT = "#ff5a5f";
const INK = "#f4f5f7";
const MUTED = "#9aa3b2";
const SANS = '"Helvetica Neue", Inter, "Segoe UI", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';

/** Breaks `text` into lines no wider than `maxWidth` in the context's current font. */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** One design unit: 1 at 720p. */
  u: number;
  local: number;
  times: number[];
}

/** Draws wrapped text at (x, y) with a fade and rise; returns the y just below it. */
function block(f: Frame, text: string, x: number, y: number, o: { size: number; weight?: string; color?: string; font?: string; maxWidth: number; lineHeight: number; at: number; align?: CanvasTextAlign; italic?: boolean }): number {
  const { ctx, u } = f;
  const r = reveal(f.local, o.at);
  ctx.font = `${o.italic ? "italic " : ""}${o.weight ?? "400"} ${Math.round(o.size * u)}px ${o.font ?? SANS}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "alphabetic";
  const lines = wrapText(ctx, text, o.maxWidth);
  ctx.save();
  ctx.globalAlpha *= r;
  ctx.fillStyle = o.color ?? INK;
  lines.forEach((l, i) => ctx.fillText(l, x, y + (1 - r) * 22 * u + (i + 1) * o.lineHeight * u - (o.lineHeight - o.size) * 0.3 * u));
  ctx.restore();
  return y + lines.length * o.lineHeight * u;
}

/** Height the same text would take, so a block can be centred before it is drawn. */
function measure(f: Frame, text: string, size: number, weight: string, maxWidth: number, lineHeight: number, font = SANS, italic = false): number {
  f.ctx.font = `${italic ? "italic " : ""}${weight} ${Math.round(size * f.u)}px ${font}`;
  return wrapText(f.ctx, text, maxWidth).length * lineHeight * f.u;
}

function drawTitle(f: Frame, scene: DocScene, script: DocScript): void {
  const { ctx, w, h, u } = f;
  const maxW = w - 220 * u;
  const heading = scene.heading || script.title;
  const lines = scene.lines.slice(0, 2).join("  ·  ");
  const total = 30 * u + measure(f, heading, 76, "800", maxW, 90) + (lines ? 50 * u : 0);
  let y = (h - total) / 2;
  block(f, "A DOCUMENTARY", w / 2, y, { size: 20, weight: "700", color: ACCENT, maxWidth: maxW, lineHeight: 30, at: 0.1, align: "center" });
  y += 30 * u + 14 * u;
  // A thin rule that draws itself under the kicker.
  ctx.fillStyle = ACCENT;
  const rule = reveal(f.local, 0.3, 0.9) * 90 * u;
  ctx.fillRect(w / 2 - rule / 2, y - 12 * u, rule, 3 * u);
  y = block(f, heading, w / 2, y, { size: 76, weight: "800", maxWidth: maxW, lineHeight: 90, at: 0.4, align: "center" });
  if (lines) block(f, lines, w / 2, y + 8 * u, { size: 28, color: MUTED, maxWidth: maxW, lineHeight: 40, at: 1.0, align: "center" });
}

function drawPoint(f: Frame, scene: DocScene, numbered: boolean): void {
  const { ctx, w, h, u } = f;
  const mx = 110 * u;
  const maxW = w - mx * 2 - 40 * u;
  const bulletW = maxW - (numbered ? 70 : 40) * u;
  const headH = measure(f, scene.heading, 60, "800", maxW, 72);
  const lineHs = scene.lines.map((l) => measure(f, l, 32, "400", bulletW, 44) + 22 * u);
  const total = headH + (lineHs.length ? 34 * u + lineHs.reduce((a, b) => a + b, 0) : 0);
  let y = Math.max(70 * u, (h - total) / 2);
  const barH = total * reveal(f.local, 0.05, 0.8);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(mx - 28 * u, y, 6 * u, barH);
  y = block(f, scene.heading, mx, y, { size: 60, weight: "800", maxWidth: maxW, lineHeight: 72, at: 0.15 });
  y += 34 * u;
  scene.lines.forEach((line, i) => {
    const at = f.times[i] ?? 0;
    const r = reveal(f.local, at);
    ctx.save();
    ctx.globalAlpha *= r;
    if (numbered) {
      ctx.fillStyle = ACCENT;
      ctx.beginPath();
      ctx.arc(mx + 22 * u, y + 24 * u + (1 - r) * 22 * u, 22 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = BG;
      ctx.font = `800 ${Math.round(26 * u)}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), mx + 22 * u, y + 25 * u + (1 - r) * 22 * u);
    } else {
      ctx.fillStyle = ACCENT;
      ctx.fillRect(mx, y + 18 * u + (1 - r) * 22 * u, 12 * u, 12 * u);
    }
    ctx.restore();
    block(f, line, mx + (numbered ? 70 : 40) * u, y, { size: 32, maxWidth: bulletW, lineHeight: 44, at });
    y += lineHs[i];
  });
}

function drawQuote(f: Frame, scene: DocScene): void {
  const { ctx, w, h, u } = f;
  const maxW = w - 300 * u;
  const quote = scene.lines[0] ?? scene.heading;
  const qh = measure(f, quote, 46, "400", maxW, 62, SERIF, true);
  let y = (h - qh - 130 * u) / 2 + 60 * u;
  ctx.save();
  ctx.globalAlpha *= reveal(f.local, 0.1) * 0.9;
  ctx.fillStyle = ACCENT;
  ctx.font = `700 ${Math.round(150 * u)}px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("“", w / 2, y);
  ctx.restore();
  y = block(f, quote, w / 2, y + 10 * u, { size: 46, font: SERIF, italic: true, maxWidth: maxW, lineHeight: 62, at: 0.4, align: "center" });
  if (scene.lines[0] && scene.heading) block(f, scene.heading.toUpperCase(), w / 2, y + 26 * u, { size: 20, weight: "700", color: MUTED, maxWidth: maxW, lineHeight: 30, at: 1.2, align: "center" });
}

function drawCredits(f: Frame, scene: DocScene, script: DocScript): void {
  const { w, h, u } = f;
  const maxW = w - 260 * u;
  let y = h / 2 - 90 * u;
  y = block(f, scene.heading || "Thanks for watching", w / 2, y, { size: 50, weight: "800", maxWidth: maxW, lineHeight: 62, at: 0.2, align: "center" });
  y = block(f, script.title, w / 2, y + 16 * u, { size: 28, color: MUTED, maxWidth: maxW, lineHeight: 40, at: 0.7, align: "center" });
  block(f, "Made with NoCap Edit", w / 2, y + 40 * u, { size: 22, weight: "700", color: ACCENT, maxWidth: maxW, lineHeight: 32, at: 1.2, align: "center" });
}

export function drawFilmFrame(ctx: CanvasRenderingContext2D, w: number, h: number, script: DocScript, tl: FilmTimeline, t: number): void {
  const timing = sceneAt(tl, t);
  const scene = script.scenes[timing.index];
  const u = h / 720;
  const local = Math.max(0, t - timing.start);
  const len = timing.end - timing.start;

  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  const gx = w * (0.5 + 0.35 * Math.sin(t * 0.15 + timing.index));
  const gy = h * (0.5 + 0.25 * Math.cos(t * 0.11 + timing.index * 2));
  const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, h * 0.95);
  glow.addColorStop(0, "rgba(255, 90, 95, 0.17)");
  glow.addColorStop(1, "rgba(255, 90, 95, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);

  const f: Frame = { ctx, w, h, u, local, times: lineRevealTimes(timing, scene.lines.length, scene.kind) };
  ctx.globalAlpha = Math.min(clamp01(local / 0.4), clamp01((len - local) / 0.4));
  switch (scene.kind) {
    case "title":
      drawTitle(f, scene, script);
      break;
    case "quote":
      drawQuote(f, scene);
      break;
    case "credits":
      drawCredits(f, scene, script);
      break;
    case "takeaways":
      drawPoint(f, scene, true);
      break;
    default:
      drawPoint(f, scene, false);
  }
  ctx.globalAlpha = 1;

  // Progress hairline along the bottom.
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fillRect(0, h - 4 * u, w, 4 * u);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(0, h - 4 * u, w * clamp01(t / tl.total), 4 * u);
}
