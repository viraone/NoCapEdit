/**
 * The "animation" film style: every scene is a moving picture instead of plain text. The script
 * says how each scene is pictured (icons, a step flow, a comparison, one big number or a
 * checklist) and this draws it frame by frame on a canvas: cards pop in, arrows draw themselves,
 * numbers count up. Like draw.ts it is a pure function of the film time, so the same frame
 * always comes out the same.
 */
import { countUp } from "./animationScript";
import { wrapText } from "./draw";
import type { DocScene, DocScript, SceneVisual } from "./script";
import { clamp01, leadFor, lineRevealTimes, reveal, sceneAt, type FilmTimeline, type SceneTiming } from "./timeline";

const BG = "#0b0d12";
const INK = "#f4f5f7";
const MUTED = "#9aa3b2";
const SANS = '"Helvetica Neue", Inter, "Segoe UI", system-ui, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
const EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

/** One accent per scene, in turn, so the film changes colour as it moves on. */
export const ANIMATION_ACCENTS = ["#ff5a5f", "#4da3ff", "#34d399", "#fbbf24", "#c084fc", "#22d3ee"];

interface Frame {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Pixels per unit: every size below is written for a 720-pixel-high frame. */
  u: number;
  /** Film time and scene-local time, in seconds. */
  t: number;
  local: number;
  timing: SceneTiming;
  index: number;
  /** The scene's fade in and out, 0 to 1; every element's own alpha multiplies it. */
  alpha: number;
  accent: string;
  /** Scene-local seconds at which each on-screen line appears. */
  times: number[];
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 0 to 1 with a small overshoot near the end: what makes a card "pop". */
export function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const p = clamp01(x) - 1;
  return 1 + (c1 + 1) * p * p * p + c1 * p * p;
}

/** The scale of something that pops in at `at` (0 before it). */
const pop = (local: number, at: number, dur = 0.5): number => (local <= at ? 0 : easeOutBack((local - at) / dur));

/** A deterministic 0-to-1 number for index `i`: the "random" in the drifting dots. */
const noise = (i: number, salt: number): number => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

interface TextStyle {
  /** In units (720-high frame). */
  size: number;
  maxWidth: number;
  weight?: string;
  color?: string;
  lineHeight?: number;
  align?: CanvasTextAlign;
  font?: string;
  italic?: boolean;
  alpha?: number;
  maxLines?: number;
}

/** Draws wrapped text from its top edge; returns the height it took, in pixels. */
function text(f: Frame, str: string, x: number, y: number, o: TextStyle): number {
  const { ctx, u } = f;
  const size = o.size * u;
  ctx.font = `${o.italic ? "italic " : ""}${o.weight ?? "500"} ${size}px ${o.font ?? SANS}`;
  ctx.textAlign = o.align ?? "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = o.color ?? INK;
  ctx.globalAlpha = f.alpha * (o.alpha ?? 1);
  const lineHeight = size * (o.lineHeight ?? 1.25);
  const lines = wrapText(ctx, str, o.maxWidth).slice(0, o.maxLines ?? 6);
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
  return lines.length * lineHeight;
}

/** One emoji centred on (cx, cy); `size` in pixels. */
function glyph(f: Frame, emoji: string, cx: number, cy: number, size: number, alpha = 1): void {
  const { ctx } = f;
  ctx.font = `${size}px ${EMOJI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.globalAlpha = f.alpha * alpha;
  ctx.fillText(emoji, cx, cy + size * 0.06);
}

/** A card: the soft panel icons, steps and comparison sides sit on. */
function card(f: Frame, x: number, y: number, w: number, h: number, color: string, alpha = 1): void {
  const { ctx, u } = f;
  roundedPath(ctx, x, y, w, h, 22 * u);
  ctx.globalAlpha = f.alpha * alpha;
  ctx.fillStyle = "rgba(255, 255, 255, 0.055)";
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = rgba(color, 0.6);
  ctx.stroke();
}

/** A round badge holding an emoji, or `fallback` (a number) when the script gave none. */
function badge(f: Frame, cx: number, cy: number, r: number, emoji: string | undefined, fallback: string, alpha = 1): void {
  const { ctx, u } = f;
  ctx.globalAlpha = f.alpha * alpha;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = rgba(f.accent, 0.18);
  ctx.fill();
  ctx.lineWidth = 2.5 * u;
  ctx.strokeStyle = f.accent;
  ctx.stroke();
  if (emoji) {
    glyph(f, emoji, cx, cy, r * 1.05, alpha);
    return;
  }
  ctx.font = `800 ${r * 0.9}px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = f.accent;
  ctx.fillText(fallback, cx, cy + r * 0.05);
}

/** Runs `draw` scaled by `s` around (cx, cy). */
function scaled(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, draw: () => void): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(s, s);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
}

function background(f: Frame): void {
  const { ctx, w, h, u, t, index } = f;
  ctx.globalAlpha = 1;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, w, h);
  // Two soft lights in the scene's colour, drifting; they dim at a cut so the colour change is not a jump.
  for (const [k, strength] of [
    [0, 0.2],
    [1, 0.1],
  ]) {
    const gx = w * (0.5 + 0.38 * Math.sin(t * 0.17 + index * 1.3 + k * 2.4));
    const gy = h * (0.5 + 0.3 * Math.cos(t * 0.13 + index * 2 + k * 1.7));
    const glow = ctx.createRadialGradient(gx, gy, 0, gx, gy, h * 0.9);
    glow.addColorStop(0, rgba(f.accent, strength * (0.35 + 0.65 * f.alpha)));
    glow.addColorStop(1, rgba(f.accent, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);
  }
  // Small dots rising slowly, each twinkling at its own pace.
  ctx.fillStyle = INK;
  for (let i = 0; i < 18; i++) {
    const rise = noise(i, 2) + t * (0.012 + 0.02 * noise(i, 3));
    const y = h * (1.05 - 1.1 * (rise - Math.floor(rise)));
    const x = w * noise(i, 1) + Math.sin(t * 0.4 + i) * 14 * u;
    ctx.globalAlpha = 0.05 + 0.1 * (0.5 + 0.5 * Math.sin(t * (0.8 + noise(i, 4)) + i));
    ctx.beginPath();
    ctx.arc(x, y, (1.5 + 3 * noise(i, 5)) * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The scene counter, the heading and the line that grows under it; returns the y just below. */
function heading(f: Frame, scene: DocScene, count: number): number {
  const { ctx, w, u, local } = f;
  const x = 90 * u;
  const a = reveal(local, 0.05);
  text(f, `${String(f.index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`, x, 62 * u, { size: 17, weight: "700", color: f.accent, maxWidth: w, alpha: a });
  const height = scene.heading ? text(f, scene.heading, x - (1 - a) * 40 * u, 92 * u, { size: 46, weight: "700", maxWidth: w - 180 * u, lineHeight: 1.15, alpha: a, maxLines: 2 }) : 0;
  const y = 92 * u + height + 14 * u;
  ctx.globalAlpha = f.alpha;
  ctx.fillStyle = f.accent;
  ctx.fillRect(x, y, 130 * u * reveal(local, 0.3, 0.6), 5 * u);
  return y + 5 * u;
}

/** Each line as a card with its emoji: they pop in one after another as the narrator reaches them. */
function drawIcons(f: Frame, scene: DocScene, visual: SceneVisual, top: number): void {
  const { ctx, w, h, u, local } = f;
  const n = scene.lines.length;
  const gap = 28 * u;
  const room = h - 60 * u - top;
  const cw = Math.min(340 * u, (w - 180 * u - gap * (n - 1)) / n);
  const ch = Math.min(380 * u, room);
  const x0 = (w - (n * cw + (n - 1) * gap)) / 2;
  const y0 = top + (room - ch) / 2;
  scene.lines.forEach((line, i) => {
    const s = pop(local, f.times[i]);
    if (s <= 0) return;
    const cx = x0 + i * (cw + gap) + cw / 2;
    const a = clamp01(s * 2);
    scaled(ctx, cx, y0 + ch / 2, s, () => {
      card(f, cx - cw / 2, y0, cw, ch, f.accent, a);
      badge(f, cx, y0 + ch * 0.34 + Math.sin(f.t * 2 + i * 1.3) * 5 * u, Math.min(76 * u, ch * 0.22), visual.icons[i], String(i + 1), a);
      text(f, line, cx, y0 + ch * 0.63, { size: 28, weight: "600", maxWidth: cw - 40 * u, align: "center", alpha: a, maxLines: 3 });
    });
  });
}

/** The lines as steps: an arrow draws itself to the next box, then the box pops in. */
function drawFlow(f: Frame, scene: DocScene, visual: SceneVisual, top: number): void {
  const { ctx, w, h, u, local } = f;
  const n = scene.lines.length;
  const arrow = 66 * u;
  const room = h - 60 * u - top;
  const bw = Math.min(290 * u, (w - 160 * u - arrow * (n - 1)) / n);
  const bh = Math.min(310 * u, room);
  const x0 = (w - (n * bw + (n - 1) * arrow)) / 2;
  const y0 = top + (room - bh) / 2;
  const mid = y0 + bh / 2;
  scene.lines.forEach((line, i) => {
    const bx = x0 + i * (bw + arrow);
    if (i > 0) {
      const p = clamp01((local - (f.times[i] - 0.4)) / 0.4);
      if (p > 0) {
        const from = bx - arrow + 9 * u;
        const to = bx - 9 * u;
        ctx.globalAlpha = f.alpha;
        ctx.strokeStyle = f.accent;
        ctx.fillStyle = f.accent;
        ctx.lineWidth = 4 * u;
        ctx.lineCap = "round";
        // The dashes keep moving after the arrow is drawn, so the flow reads as a direction.
        ctx.setLineDash([10 * u, 8 * u]);
        ctx.lineDashOffset = -f.t * 40 * u;
        ctx.beginPath();
        ctx.moveTo(from, mid);
        ctx.lineTo(from + (to - 12 * u - from) * p, mid);
        ctx.stroke();
        ctx.setLineDash([]);
        if (p >= 1) {
          ctx.beginPath();
          ctx.moveTo(to, mid);
          ctx.lineTo(to - 16 * u, mid - 11 * u);
          ctx.lineTo(to - 16 * u, mid + 11 * u);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    const s = pop(local, f.times[i]);
    if (s <= 0) return;
    const cx = bx + bw / 2;
    const a = clamp01(s * 2);
    scaled(ctx, cx, mid, s, () => {
      card(f, bx, y0, bw, bh, f.accent, a);
      text(f, `STEP ${i + 1}`, bx + 16 * u, y0 + 14 * u, { size: 15, weight: "800", color: f.accent, maxWidth: bw, alpha: a });
      badge(f, cx, y0 + bh * 0.4, Math.min(54 * u, bh * 0.2), visual.icons[i], String(i + 1), a);
      text(f, line, cx, y0 + bh * 0.65, { size: 24, weight: "600", maxWidth: bw - 28 * u, align: "center", alpha: a, maxLines: 3, lineHeight: 1.2 });
    });
  });
}

/** Two panels sliding in from the sides with a VS between them. */
function drawCompare(f: Frame, scene: DocScene, compare: NonNullable<SceneVisual["compare"]>, top: number): void {
  const { ctx, w, h, u, local } = f;
  const room = h - 60 * u - top;
  const pw = (w - 180 * u - 96 * u) / 2;
  const ph = Math.min(390 * u, room);
  const y0 = top + (room - ph) / 2;
  const first = leadFor(scene.kind) * 0.6;
  const second = first + Math.max(1, f.timing.speech * 0.4);
  const other = ANIMATION_ACCENTS[(f.index + 2) % ANIMATION_ACCENTS.length];
  const sides = [
    { title: compare.leftTitle, points: compare.left, at: first, x: 90 * u, dir: -1, color: f.accent },
    { title: compare.rightTitle, points: compare.right, at: second, x: w - 90 * u - pw, dir: 1, color: other },
  ];
  for (const side of sides) {
    const a = reveal(local, side.at, 0.6);
    if (a <= 0) continue;
    const x = side.x + (1 - a) * side.dir * 140 * u;
    card(f, x, y0, pw, ph, side.color, a);
    text(f, side.title, x + 30 * u, y0 + 28 * u, { size: 34, weight: "800", color: side.color, maxWidth: pw - 60 * u, alpha: a, maxLines: 1 });
    let y = y0 + 102 * u;
    side.points.forEach((point, j) => {
      const pa = reveal(local, side.at + 0.5 + j * 0.45);
      if (pa <= 0) return;
      ctx.globalAlpha = f.alpha * pa;
      ctx.fillStyle = side.color;
      ctx.beginPath();
      ctx.arc(x + 40 * u, y + 17 * u, 7 * u, 0, Math.PI * 2);
      ctx.fill();
      y += text(f, point, x + 62 * u + (1 - pa) * 24 * u, y, { size: 28, maxWidth: pw - 94 * u, alpha: pa, maxLines: 2, lineHeight: 1.2 }) + 18 * u;
    });
  }
  const s = pop(local, Math.max(first + 0.3, second - 0.25));
  if (s > 0) {
    const cx = w / 2;
    const cy = y0 + ph / 2;
    scaled(ctx, cx, cy, s, () => {
      ctx.globalAlpha = f.alpha;
      ctx.beginPath();
      ctx.arc(cx, cy, 38 * u, 0, Math.PI * 2);
      ctx.fillStyle = BG;
      ctx.fill();
      ctx.lineWidth = 3 * u;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.font = `800 ${22 * u}px ${SANS}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = INK;
      ctx.fillText("VS", cx, cy + u);
    });
  }
}

/** One big number counting up inside a ring that closes as it goes. */
function drawStat(f: Frame, stat: NonNullable<SceneVisual["stat"]>, top: number): void {
  const { ctx, w, h, u, local } = f;
  const room = h - 60 * u - top;
  const r = Math.min(175 * u, room * 0.36);
  const cx = w / 2;
  const cy = top + r + 14 * u;
  const p = reveal(local, 0.45, 1.8);
  ctx.globalAlpha = f.alpha;
  ctx.lineWidth = 10 * u;
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  if (p > 0) {
    ctx.strokeStyle = f.accent;
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p);
    ctx.stroke();
  }
  // The final figure sets the size, so the number does not change size while it counts.
  let size = 108 * u;
  ctx.font = `800 ${size}px ${SANS}`;
  const width = ctx.measureText(stat.value).width;
  if (width > r * 1.6) size *= (r * 1.6) / width;
  const beat = p >= 1 ? 1 + 0.015 * Math.sin(f.t * 3) : 1;
  ctx.font = `800 ${size * beat}px ${SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = INK;
  ctx.globalAlpha = f.alpha * reveal(local, 0.3);
  ctx.fillText(countUp(stat.value, p), cx, cy + size * 0.04);
  if (stat.label) text(f, stat.label, cx, cy + r + 26 * u, { size: 30, color: MUTED, maxWidth: w - 300 * u, align: "center", alpha: reveal(local, 1.1), maxLines: 2 });
}

/** A checklist: each row's badge pops, its tick draws itself, and the words slide in. */
function drawList(f: Frame, scene: DocScene, visual: SceneVisual, top: number): void {
  const { ctx, w, h, u, local } = f;
  const n = scene.lines.length;
  if (!n) return;
  const room = h - 60 * u - top;
  const rowH = Math.min(110 * u, room / n);
  const y0 = top + (room - rowH * n) / 2;
  const x = 110 * u;
  const r = Math.min(34 * u, rowH * 0.34);
  scene.lines.forEach((line, i) => {
    const at = f.times[i];
    const a = reveal(local, at);
    if (a <= 0) return;
    const cx = x + r;
    const cy = y0 + i * rowH + rowH / 2;
    const emoji = visual.icons[i];
    scaled(ctx, cx, cy, pop(local, at), () => {
      if (emoji) {
        badge(f, cx, cy, r, emoji, "", a);
        return;
      }
      ctx.globalAlpha = f.alpha * a;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = f.accent;
      ctx.fill();
      // The tick: two strokes, drawn in order.
      const p = clamp01((local - at - 0.15) / 0.3);
      const pts = [
        [-0.42, 0.02],
        [-0.12, 0.32],
        [0.44, -0.32],
      ];
      ctx.strokeStyle = BG;
      ctx.lineWidth = 4.5 * u;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(cx + pts[0][0] * r, cy + pts[0][1] * r);
      const firstLeg = clamp01(p / 0.4);
      ctx.lineTo(cx + (pts[0][0] + (pts[1][0] - pts[0][0]) * firstLeg) * r, cy + (pts[0][1] + (pts[1][1] - pts[0][1]) * firstLeg) * r);
      if (p > 0.4) {
        const secondLeg = clamp01((p - 0.4) / 0.6);
        ctx.lineTo(cx + (pts[1][0] + (pts[2][0] - pts[1][0]) * secondLeg) * r, cy + (pts[1][1] + (pts[2][1] - pts[1][1]) * secondLeg) * r);
      }
      if (p > 0) ctx.stroke();
    });
    const size = n > 3 ? 31 : 36;
    text(f, line, x + r * 2 + 26 * u + (1 - a) * 50 * u, cy - size * u * 0.58, { size, maxWidth: w - x - r * 2 - 116 * u, alpha: a, maxLines: 2, lineHeight: 1.15 });
  });
}

/** The opening: rings turning behind the title, whose words rise in one at a time. */
function drawTitleScene(f: Frame, scene: DocScene, script: DocScript, visual: SceneVisual): void {
  const { ctx, w, h, u, local } = f;
  const cx = w / 2;
  for (let k = 0; k < 3; k++) {
    const r = (170 + k * 80) * u;
    const angle = f.t * (0.5 - k * 0.13) + k * 2.1;
    ctx.globalAlpha = f.alpha * 0.5;
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = rgba(f.accent, 0.3);
    ctx.beginPath();
    ctx.arc(cx, h * 0.5, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = f.accent;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(angle) * r, h * 0.5 + Math.sin(angle) * r, (7 - k * 1.5) * u, 0, Math.PI * 2);
    ctx.fill();
  }
  const emoji = visual.icons[0];
  if (emoji) {
    const s = pop(local, 0.15);
    if (s > 0) glyph(f, emoji, cx, h * 0.2 + Math.sin(f.t * 1.8) * 6 * u, 84 * u * s, clamp01(s * 2));
  }
  text(f, "ANIMATED EXPLAINER", cx, h * 0.31, { size: 17, weight: "800", color: f.accent, maxWidth: w, align: "center", alpha: reveal(local, 0.2) });

  const size = 68 * u;
  ctx.font = `800 ${size}px ${SANS}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const lines = wrapText(ctx, script.title, w - 260 * u).slice(0, 3);
  const lineHeight = size * 1.14;
  const space = ctx.measureText(" ").width;
  const y0 = h * 0.38;
  let word = 0;
  lines.forEach((line, i) => {
    let x = cx - ctx.measureText(line).width / 2;
    for (const part of line.split(" ")) {
      const a = reveal(local, 0.35 + word * 0.12, 0.5);
      ctx.globalAlpha = f.alpha * a;
      ctx.fillStyle = INK;
      ctx.fillText(part, x, y0 + i * lineHeight + (1 - a) * 34 * u);
      x += ctx.measureText(part).width + space;
      word++;
    }
  });
  if (scene.lines[0]) text(f, scene.lines[0], cx, y0 + lines.length * lineHeight + 22 * u, { size: 26, color: MUTED, maxWidth: w - 320 * u, align: "center", alpha: reveal(local, 0.55 + word * 0.12), maxLines: 2 });
}

/** A quote typed out letter by letter under a big quotation mark. */
function drawQuoteScene(f: Frame, scene: DocScene): void {
  const { ctx, w, u, local } = f;
  const quote = scene.lines[0] || scene.heading;
  text(f, "“", 84 * u, 40 * u, { size: 240, font: SERIF, weight: "700", color: f.accent, maxWidth: w, alpha: reveal(local, 0) * 0.9 });
  const size = 44 * u;
  ctx.font = `italic 500 ${size}px ${SERIF}`;
  // Wrapped once from the whole quote, so words do not jump lines while it is being typed.
  const lines = wrapText(ctx, quote, w - 340 * u).slice(0, 6);
  const typing = Math.max(1.2, f.timing.speech * 0.6);
  let left = Math.floor(quote.length * clamp01((local - 0.5) / typing));
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillStyle = INK;
  ctx.globalAlpha = f.alpha;
  const y0 = 232 * u;
  lines.forEach((line, i) => {
    if (left <= 0) return;
    ctx.fillText(line.slice(0, left), 170 * u, y0 + i * size * 1.32);
    left -= line.length + 1;
  });
  if (scene.heading && scene.lines[0]) text(f, `— ${scene.heading}`, 170 * u, y0 + lines.length * size * 1.32 + 26 * u, { size: 24, color: MUTED, maxWidth: w - 340 * u, alpha: reveal(local, 0.5 + typing), maxLines: 1 });
}

function drawCreditsScene(f: Frame, scene: DocScene, script: DocScript): void {
  const { w, h, u, local } = f;
  const cx = w / 2;
  let y = h * 0.34;
  if (scene.heading) y += text(f, scene.heading.toUpperCase(), cx, y, { size: 17, weight: "800", color: f.accent, maxWidth: w - 300 * u, align: "center", alpha: reveal(local, 0.1), maxLines: 1 }) + 18 * u;
  y += text(f, script.title, cx, y, { size: 50, weight: "800", maxWidth: w - 300 * u, align: "center", alpha: reveal(local, 0.25), lineHeight: 1.15, maxLines: 3 }) + 24 * u;
  scene.lines.forEach((line, i) => {
    y += text(f, line, cx, y, { size: 24, color: MUTED, maxWidth: w - 360 * u, align: "center", alpha: reveal(local, 0.6 + i * 0.3), maxLines: 2 }) + 8 * u;
  });
}

/** Draws one frame of an animation film at film time `t` (seconds). Same arguments as drawFilmFrame. */
export function drawAnimationFrame(ctx: CanvasRenderingContext2D, w: number, h: number, script: DocScript, tl: FilmTimeline, t: number): void {
  const timing = sceneAt(tl, t);
  const scene = script.scenes[timing.index];
  const u = h / 720;
  const local = Math.max(0, t - timing.start);
  const len = timing.end - timing.start;
  const accent = ANIMATION_ACCENTS[timing.index % ANIMATION_ACCENTS.length];
  const f: Frame = {
    ctx,
    w,
    h,
    u,
    t,
    local,
    timing,
    index: timing.index,
    alpha: Math.min(clamp01(local / 0.4), clamp01((len - local) / 0.4)),
    accent,
    times: lineRevealTimes(timing, scene.lines.length, scene.kind),
  };
  // A script written for the documentary style has no pictures: everything falls back to a checklist.
  const visual: SceneVisual = scene.visual ?? { type: "list", icons: [] };

  background(f);

  // The whole scene slides in from the right and leaves to the left.
  ctx.save();
  ctx.translate(((1 - reveal(local, 0, 0.5)) - (1 - clamp01((len - local) / 0.4))) * 70 * u, 0);
  if (scene.kind === "title") drawTitleScene(f, scene, script, visual);
  else if (scene.kind === "quote") drawQuoteScene(f, scene);
  else if (scene.kind === "credits") drawCreditsScene(f, scene, script);
  else {
    const top = heading(f, scene, script.scenes.length) + 32 * u;
    const lines = scene.lines.length;
    if (scene.kind !== "takeaways" && visual.type === "stat" && visual.stat) drawStat(f, visual.stat, top);
    else if (scene.kind !== "takeaways" && visual.type === "compare" && visual.compare) drawCompare(f, scene, visual.compare, top);
    else if (scene.kind !== "takeaways" && visual.type === "icons" && lines >= 2) drawIcons(f, scene, visual, top);
    else if (scene.kind !== "takeaways" && visual.type === "flow" && lines >= 2) drawFlow(f, scene, visual, top);
    else drawList(f, scene, visual, top);
  }
  ctx.restore();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Progress hairline along the bottom, in the scene's colour.
  ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
  ctx.fillRect(0, h - 4 * u, w, 4 * u);
  ctx.fillStyle = accent;
  ctx.fillRect(0, h - 4 * u, w * clamp01(t / tl.total), 4 * u);
}
