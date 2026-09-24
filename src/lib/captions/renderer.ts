/**
 * Canvas renderer shared by the live preview and the export pipeline so that
 * what you see in the editor is exactly what gets burned into the MP4.
 * All positions are expressed in frame pixels (e.g. 1080x1920).
 */
import {
  overlayCenter,
  type CaptionCue,
  type ImageOverlay,
  type SubtitleStyle,
  type TextOverlay,
  type VideoProject,
  type WordTiming,
} from "@/lib/models/project";
import { fontFamily } from "./fonts";
import { getPreset, type CaptionPreset, type HighlightMode } from "./presets";

const SPEAKER_PALETTE = ["#facc15", "#38bdf8", "#f472b6", "#4ade80", "#fb923c", "#a78bfa", "#f87171", "#2dd4bf"];
export function speakerPaletteColor(index: number): string {
  return SPEAKER_PALETTE[index % SPEAKER_PALETTE.length];
}

export interface Frame {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ---------- helpers ----------

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function setLetterSpacing(ctx: Ctx, px: number) {
  if ("letterSpacing" in ctx) {
    (ctx as CanvasRenderingContext2D).letterSpacing = `${px}px`;
  }
}

function clearShadow(ctx: Ctx) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function cueDisplayText(cue: CaptionCue, showTranslated: boolean): string {
  if (showTranslated && cue.translatedText && cue.translatedText.trim()) return cue.translatedText;
  return cue.text;
}

/**
 * Word timings for the displayed tokens. Uses the recognised timings when the
 * token count still matches, otherwise distributes the cue duration by
 * character length (handles edited or translated text).
 */
export function wordTimingsFor(cue: CaptionCue, tokens: string[]): WordTiming[] {
  if (cue.words && cue.words.length === tokens.length) {
    return cue.words.map((w, i) => ({ text: tokens[i], start: w.start, end: w.end }));
  }
  const total = tokens.reduce((s, t) => s + Math.max(1, t.length), 0);
  const span = Math.max(0.01, cue.end - cue.start);
  let t = cue.start;
  return tokens.map((tok) => {
    const d = (Math.max(1, tok.length) / total) * span;
    const w = { text: tok, start: t, end: t + d };
    t += d;
    return w;
  });
}

export function activeWordIndex(timings: WordTiming[], time: number): number {
  let idx = -1;
  for (let i = 0; i < timings.length; i++) {
    if (time >= timings[i].start) idx = i;
    else break;
  }
  return idx;
}

// ---------- caption style ----------

export interface ResolvedCaptionStyle {
  preset: CaptionPreset;
  fontPx: number;
  font: string;
  color: string;
  accent: string;
  highlight: HighlightMode | null;
  uppercase: boolean;
  letterSpacingPx: number;
  lineHeightPx: number;
  maxWidthPx: number;
}

export function resolveCaptionStyle(style: SubtitleStyle, frame: Frame): ResolvedCaptionStyle {
  const preset = getPreset(style.presetId);
  const fontPx = Math.max(8, Math.round(preset.size * frame.height * style.sizeScale));
  const font = `${preset.italic ? "italic " : ""}${preset.weight} ${fontPx}px ${fontFamily(preset.font)}`;
  return {
    preset,
    fontPx,
    font,
    color: style.textColor ?? preset.color,
    accent: style.accentColor ?? preset.accent,
    highlight: style.highlight ? preset.highlight : null,
    uppercase: style.uppercase ?? preset.uppercase ?? false,
    letterSpacingPx: (preset.letterSpacing ?? 0) * fontPx,
    lineHeightPx: preset.lineHeight * fontPx,
    maxWidthPx: Math.max(fontPx * 2, style.maxWidth * frame.width),
  };
}

export interface WordBox {
  text: string;
  index: number;
  x: number;
  y: number;
  w: number;
}
export interface LineLayout {
  words: WordBox[];
  x: number;
  y: number;
  w: number;
}
export interface CueLayout {
  lines: LineLayout[];
  bounds: Rect;
  textBounds: Rect;
  fontPx: number;
}

function measureWord(ctx: Ctx, text: string, spacing: number): number {
  return ctx.measureText(text).width + spacing * text.length;
}

export function layoutWords(
  ctx: Ctx,
  tokens: string[],
  rs: ResolvedCaptionStyle,
  anchorPx: { x: number; y: number },
): CueLayout {
  ctx.font = rs.font;
  setLetterSpacing(ctx, 0);
  const spaceW = measureWord(ctx, " ", rs.letterSpacingPx);
  const widths = tokens.map((t) => measureWord(ctx, t, rs.letterSpacingPx));

  const lines: { idx: number[]; w: number }[] = [];
  let cur: number[] = [];
  let curW = 0;
  tokens.forEach((_, i) => {
    const w = widths[i];
    const next = cur.length ? curW + spaceW + w : w;
    if (cur.length && next > rs.maxWidthPx) {
      lines.push({ idx: cur, w: curW });
      cur = [i];
      curW = w;
    } else {
      cur.push(i);
      curW = next;
    }
  });
  if (cur.length) lines.push({ idx: cur, w: curW });

  const totalH = lines.length * rs.lineHeightPx;
  const top = anchorPx.y - totalH / 2;
  const out: LineLayout[] = lines.map((line, li) => {
    const x = anchorPx.x - line.w / 2;
    const y = top + (li + 0.5) * rs.lineHeightPx;
    let cx = x;
    const words = line.idx.map((wi) => {
      const box: WordBox = { text: tokens[wi], index: wi, x: cx, y, w: widths[wi] };
      cx += widths[wi] + spaceW;
      return box;
    });
    return { words, x, y, w: line.w };
  });

  const minX = Math.min(...out.map((l) => l.x));
  const maxX = Math.max(...out.map((l) => l.x + l.w));
  const textBounds: Rect = { x: minX, y: top, w: maxX - minX, h: totalH };
  const box = rs.preset.box;
  const padX = box ? box.padX * rs.fontPx : 0;
  const padY = box ? box.padY * rs.fontPx : 0;
  const bounds: Rect = { x: minX - padX, y: top - padY, w: maxX - minX + padX * 2, h: totalH + padY * 2 };
  return { lines: out, bounds, textBounds, fontPx: rs.fontPx };
}

function applyShadow(ctx: Ctx, rs: ResolvedCaptionStyle) {
  const s = rs.preset.shadow;
  if (!s) return clearShadow(ctx);
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur * rs.fontPx;
  ctx.shadowOffsetX = s.x * rs.fontPx;
  ctx.shadowOffsetY = s.y * rs.fontPx;
}

function drawWordPass(
  ctx: Ctx,
  layout: CueLayout,
  rs: ResolvedCaptionStyle,
  activeIndex: number,
  pass: "stroke" | "fill",
) {
  const preset = rs.preset;
  for (const line of layout.lines) {
    for (const word of line.words) {
      const active = word.index === activeIndex && rs.highlight !== null;
      const scaled = active && rs.highlight === "scale";
      ctx.save();
      if (scaled) {
        const cx = word.x + word.w / 2;
        ctx.translate(cx, word.y);
        ctx.scale(1.14, 1.14);
        ctx.translate(-cx, -word.y);
      }
      if (pass === "stroke" && preset.stroke) {
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = preset.stroke.width * rs.fontPx;
        ctx.strokeStyle = preset.stroke.color;
        ctx.strokeText(word.text, word.x, word.y);
      } else if (pass === "fill") {
        const useAccent = active && rs.highlight !== "box";
        ctx.fillStyle = useAccent ? rs.accent : rs.color;
        ctx.fillText(word.text, word.x, word.y);
        if (active && rs.highlight === "underline") {
          clearShadow(ctx);
          ctx.fillStyle = rs.accent;
          const h = Math.max(2, rs.fontPx * 0.08);
          ctx.fillRect(word.x, word.y + rs.fontPx * 0.5, word.w, h);
        }
      }
      ctx.restore();
    }
  }
}

export interface DrawCueOptions {
  showTranslated: boolean;
}

/**
 * Draws a caption cue and returns its layout (for hit-testing). Returns null
 * when the cue has no visible text.
 */
export function drawCue(
  ctx: Ctx,
  cue: CaptionCue,
  style: SubtitleStyle,
  frame: Frame,
  time: number,
  opts: DrawCueOptions,
): CueLayout | null {
  const rs = resolveCaptionStyle(style, frame);
  if (style.speakerColors && cue.speaker !== undefined) {
    const c = speakerPaletteColor(cue.speaker);
    rs.color = c;
    if (rs.accent.toLowerCase() === c.toLowerCase()) rs.accent = "#ffffff";
  }
  const raw = cueDisplayText(cue, opts.showTranslated);
  const tokens = tokenize(rs.uppercase ? raw.toUpperCase() : raw);
  if (!tokens.length) return null;
  const anchor = cue.anchor ?? { x: style.x, y: style.y };
  const anchorPx = { x: anchor.x * frame.width, y: anchor.y * frame.height };

  ctx.save();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const layout = layoutWords(ctx, tokens, rs, anchorPx);
  const timings = wordTimingsFor(cue, tokens);
  const inside = time >= cue.start && time <= cue.end;
  const activeIndex = inside && rs.highlight ? activeWordIndex(timings, time) : -1;
  const preset = rs.preset;

  // Background boxes
  if (preset.box) {
    clearShadow(ctx);
    ctx.fillStyle = preset.box.color;
    const r = preset.box.radius * rs.fontPx;
    if (preset.box.mode === "block") {
      roundRect(ctx, layout.bounds.x, layout.bounds.y, layout.bounds.w, layout.bounds.h, r);
      ctx.fill();
    } else {
      const padX = preset.box.padX * rs.fontPx;
      const padY = preset.box.padY * rs.fontPx;
      const h = rs.fontPx * 1.15 + padY * 2;
      for (const line of layout.lines) {
        roundRect(ctx, line.x - padX, line.y - h / 2, line.w + padX * 2, h, r);
        ctx.fill();
      }
    }
  }

  // Word highlight box
  if (activeIndex >= 0 && rs.highlight === "box") {
    clearShadow(ctx);
    ctx.fillStyle = rs.accent;
    for (const line of layout.lines) {
      for (const w of line.words) {
        if (w.index !== activeIndex) continue;
        const pad = rs.fontPx * 0.18;
        roundRect(ctx, w.x - pad, w.y - rs.fontPx * 0.6, w.w + pad * 2, rs.fontPx * 1.2, rs.fontPx * 0.15);
        ctx.fill();
      }
    }
  }

  ctx.font = rs.font;
  setLetterSpacing(ctx, rs.letterSpacingPx);

  // Glow: blurred copies drawn behind the text
  if (preset.glow) {
    ctx.save();
    ctx.shadowColor = preset.glow.color;
    ctx.shadowBlur = preset.glow.blur * rs.fontPx;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    drawWordPass(ctx, layout, rs, activeIndex, "fill");
    drawWordPass(ctx, layout, rs, activeIndex, "fill");
    ctx.restore();
  }

  if (preset.stroke) {
    applyShadow(ctx, rs);
    drawWordPass(ctx, layout, rs, activeIndex, "stroke");
    clearShadow(ctx);
    drawWordPass(ctx, layout, rs, activeIndex, "fill");
  } else {
    applyShadow(ctx, rs);
    drawWordPass(ctx, layout, rs, activeIndex, "fill");
  }
  ctx.restore();
  return layout;
}

// ---------- text overlays ----------

interface TextOverlayLayout {
  lines: { text: string; x: number; y: number; w: number }[];
  bounds: Rect;
  fontPx: number;
  font: string;
}

export function layoutTextOverlay(ctx: Ctx, ov: TextOverlay, frame: Frame, time = ov.start): TextOverlayLayout {
  const fontPx = Math.max(8, Math.round(ov.fontSize * frame.height));
  const font = `${ov.italic ? "italic " : ""}${ov.bold ? 700 : 400} ${fontPx}px ${fontFamily(ov.fontFamily)}`;
  ctx.font = font;
  setLetterSpacing(ctx, 0);
  const lineH = fontPx * 1.25;
  const padX = fontPx * 0.5;
  const padY = fontPx * 0.3;
  const isBanner = ov.variant === "banner";
  const maxW = isBanner ? frame.width - padX * 2 : Math.max(fontPx, ov.maxWidth * frame.width);

  const paragraphs = ov.text.split(/\n/);
  const wrapped: string[] = [];
  for (const p of paragraphs) {
    const words = tokenize(p);
    if (!words.length) {
      wrapped.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      const candidate = line ? `${line} ${w}` : w;
      if (line && ctx.measureText(candidate).width > maxW) {
        wrapped.push(line);
        line = w;
      } else line = candidate;
    }
    wrapped.push(line);
  }
  const widths = wrapped.map((l) => ctx.measureText(l).width);
  const contentW = isBanner ? frame.width - padX * 2 : Math.max(...widths, 1);
  const contentH = wrapped.length * lineH;
  const center = overlayCenter(ov, time);
  const cx = center.x * frame.width;
  const cy = center.y * frame.height;
  const bounds: Rect = isBanner
    ? { x: 0, y: cy - contentH / 2 - padY, w: frame.width, h: contentH + padY * 2 }
    : { x: cx - contentW / 2 - padX, y: cy - contentH / 2 - padY, w: contentW + padX * 2, h: contentH + padY * 2 };
  const left = bounds.x + padX;
  const lines = wrapped.map((text, i) => {
    const w = widths[i];
    let x = left;
    if (ov.align === "center") x = left + (contentW - w) / 2;
    if (ov.align === "right") x = left + contentW - w;
    return { text, x, y: bounds.y + padY + (i + 0.5) * lineH, w };
  });
  return { lines, bounds, fontPx, font };
}

export function textOverlayRect(ctx: Ctx, ov: TextOverlay, frame: Frame, time = ov.start): Rect {
  ctx.save();
  const l = layoutTextOverlay(ctx, ov, frame, time);
  ctx.restore();
  return l.bounds;
}

export function drawTextOverlay(ctx: Ctx, ov: TextOverlay, frame: Frame, time = ov.start) {
  ctx.save();
  const layout = layoutTextOverlay(ctx, ov, frame, time);
  const cx = layout.bounds.x + layout.bounds.w / 2;
  const cy = layout.bounds.y + layout.bounds.h / 2;
  ctx.globalAlpha = ov.opacity;
  if (ov.rotation) {
    ctx.translate(cx, cy);
    ctx.rotate((ov.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  if (ov.background) {
    ctx.fillStyle = ov.background;
    const r = ov.variant === "banner" ? 0 : layout.fontPx * 0.25;
    roundRect(ctx, layout.bounds.x, layout.bounds.y, layout.bounds.w, layout.bounds.h, r);
    ctx.fill();
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = layout.fontPx * 0.2;
    ctx.shadowOffsetY = layout.fontPx * 0.05;
  }
  ctx.font = layout.font;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillStyle = ov.color;
  for (const line of layout.lines) ctx.fillText(line.text, line.x, line.y);
  ctx.restore();
}

// ---------- image overlays ----------

export function imageOverlayRect(ov: ImageOverlay, frame: Frame, time = ov.start): Rect {
  const w = ov.width * frame.width;
  const h = w / Math.max(0.01, ov.aspect);
  const c = overlayCenter(ov, time);
  return { x: c.x * frame.width - w / 2, y: c.y * frame.height - h / 2, w, h };
}

export function drawImageOverlay(ctx: Ctx, ov: ImageOverlay, image: CanvasImageSource, frame: Frame, time = ov.start) {
  const r = imageOverlayRect(ov, frame, time);
  ctx.save();
  ctx.globalAlpha = ov.opacity;
  if (ov.rotation) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.translate(cx, cy);
    ctx.rotate((ov.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }
  ctx.drawImage(image, r.x, r.y, r.w, r.h);
  ctx.restore();
}

// ---------- full overlay layer ----------

export interface LayerOptions {
  images: (assetId: string) => CanvasImageSource | undefined;
  includeCaptions?: boolean;
  includeOverlays?: boolean;
}

export function isActive(item: { start: number; end: number }, time: number): boolean {
  return time >= item.start && time < item.end;
}

export function activeCues(project: VideoProject, time: number): CaptionCue[] {
  return project.cues.filter((c) => isActive(c, time));
}

export interface ElementRect {
  id: string;
  kind: "overlay" | "cue";
  rect: Rect;
}

/**
 * Draws every overlay and caption visible at `time`. Returns the rectangles of
 * what was drawn so the editor can hit-test and show selection handles.
 */
export function drawOverlayLayer(
  ctx: Ctx,
  project: VideoProject,
  time: number,
  frame: Frame,
  opts: LayerOptions,
): ElementRect[] {
  const rects: ElementRect[] = [];
  if (opts.includeOverlays !== false) {
    for (const ov of project.overlays) {
      if (!isActive(ov, time)) continue;
      if (ov.kind === "text") {
        drawTextOverlay(ctx, ov, frame, time);
        rects.push({ id: ov.id, kind: "overlay", rect: textOverlayRect(ctx, ov, frame, time) });
      } else {
        const img = opts.images(ov.assetId);
        if (img) drawImageOverlay(ctx, ov, img, frame, time);
        rects.push({ id: ov.id, kind: "overlay", rect: imageOverlayRect(ov, frame, time) });
      }
    }
  }
  if (opts.includeCaptions !== false && project.captions.visible) {
    for (const cue of activeCues(project, time)) {
      const layout = drawCue(ctx, cue, project.subtitleStyle, frame, time, {
        showTranslated: project.captions.showTranslated,
      });
      if (layout) rects.push({ id: cue.id, kind: "cue", rect: layout.bounds });
    }
  }
  return rects;
}
