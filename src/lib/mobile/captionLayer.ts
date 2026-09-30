/**
 * Cached caption compositing for the exporters.
 *
 * drawCue() lays the words out and paints stroke/shadow/fill passes — fine
 * once, expensive thirty times a second at 1080p on a phone. A caption only
 * *looks* different when the spoken word changes, or while that word is
 * mid-animation (the pop/bounce looks). So captions live on two transparent
 * layers: the static words, redrawn when the spoken word changes, and the
 * active word alone, redrawn per animation step. Each frame just blits (or
 * textures) the layers unless their keys changed.
 */
import type { CaptionCue, SubtitleStyle, WordTiming } from "@/lib/models/project";
import {
  activeWordIndex,
  cueDisplayText,
  drawCue,
  resolveCaptionStyle,
  tokenize,
  wordTimingsFor,
  type Ctx,
  type CueLayout,
  type Frame,
  type Rect,
  type ResolvedCaptionStyle,
} from "@/lib/captions/renderer";

/** How long the active-word animation runs (see activeWordScale). */
const ANIMATION_SECONDS = { pop: 0.18, bounce: 0.35 } as const;
/** The moving part is sampled at this rate, so a 30 fps export redraws the
 * active word every other frame during the animation, not every frame. */
const ANIMATION_STEPS_PER_SECOND = 20;

export type CaptionCanvas = OffscreenCanvas | HTMLCanvasElement;

export interface CaptionLayerContent {
  canvas: CaptionCanvas;
  version: number;
  /** Where the painted pixels are, in layer coordinates (generously padded
   * for strokes, shadows and glows); everything outside is transparent. A
   * compositor that keeps its own copy of the layer only needs to refresh
   * the union of this and the previous rect. */
  rect: Rect;
}

export interface CaptionLayers {
  /** Static words. Null when no caption is showing. */
  static: CaptionLayerContent | null;
  /** The highlighted word. Null when nothing is highlighted. */
  active: CaptionLayerContent | null;
  /** Where the layers sit in the frame: they cover the full width and
   * only the horizontal band the captions can occupy. */
  band: { top: number; height: number };
}

/** Captions live around their anchor; the layers cover this much of the
 * frame height around it rather than the whole frame, which makes every
 * clear, raster and texture upload proportionally cheaper. */
const BAND_FRACTION = 0.5;

/** The largest the active word gets mid-animation (bounce peak on a "scale" highlight). */
const MAX_ACTIVE_SCALE = 1.4;

/** How far strokes, shadows and glows can reach beyond the glyph boxes, in pixels. */
function effectPad(rs: ResolvedCaptionStyle): number {
  const p = rs.preset;
  const shadow = p.shadow ? p.shadow.blur * 2 + Math.max(Math.abs(p.shadow.x), Math.abs(p.shadow.y)) : 0;
  const glow = p.glow ? p.glow.blur * 2 : 0;
  return rs.fontPx * (0.7 + (p.stroke?.width ?? 0) + shadow + glow);
}

function union(a: Rect | null, b: Rect): Rect {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Frame-space rect → whole-pixel layer rect, clamped to the band (at least 1×1). */
function toLayerRect(r: Rect | null, band: { top: number; height: number }, width: number): Rect {
  if (!r) return { x: 0, y: 0, w: 1, h: 1 };
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y - band.top));
  const x1 = Math.min(width, Math.ceil(r.x + r.w));
  const y1 = Math.min(band.height, Math.ceil(r.y + r.h - band.top));
  if (x1 <= x0 || y1 <= y0) return { x: 0, y: 0, w: 1, h: 1 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function makeLayer(width: number, height: number): { canvas: CaptionCanvas; ctx: Ctx } {
  let canvas: CaptionCanvas;
  if (typeof OffscreenCanvas !== "undefined") {
    canvas = new OffscreenCanvas(width, height);
  } else {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    canvas = c;
  }
  const ctx = canvas.getContext("2d") as Ctx | null;
  if (!ctx) throw new Error("Canvas is not available.");
  return { canvas, ctx };
}

export class CaptionLayer {
  private readonly staticLayer: { canvas: CaptionCanvas; ctx: Ctx };
  private readonly activeLayer: { canvas: CaptionCanvas; ctx: Ctx };
  private readonly rs: ResolvedCaptionStyle;
  private readonly timings = new Map<string, WordTiming[]>();
  private staticKey = "";
  private activeKey = "";
  private staticVersion = 0;
  private activeVersion = 0;
  private staticRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private activeRect: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private readonly band: { top: number; height: number };

  constructor(
    private readonly cues: CaptionCue[],
    private readonly style: SubtitleStyle,
    private readonly frame: Frame,
  ) {
    const bandHeight = Math.min(frame.height, Math.round(frame.height * BAND_FRACTION));
    const top = Math.round(Math.min(Math.max(0, style.y * frame.height - bandHeight / 2), frame.height - bandHeight));
    this.band = { top, height: bandHeight };
    this.staticLayer = makeLayer(frame.width, bandHeight);
    this.activeLayer = makeLayer(frame.width, bandHeight);
    // Draw in frame coordinates; the layer is a window onto the band.
    this.staticLayer.ctx.translate(0, -top);
    this.activeLayer.ctx.translate(0, -top);
    this.rs = resolveCaptionStyle(style, frame);
  }

  /** How many times a layer was actually re-rendered (vs. reused). */
  get renders(): number {
    return this.staticVersion + this.activeVersion;
  }

  private timingsFor(cue: CaptionCue): WordTiming[] {
    let t = this.timings.get(cue.id);
    if (!t) {
      t = wordTimingsFor(cue, tokenize(cueDisplayText(cue, false)));
      this.timings.set(cue.id, t);
    }
    return t;
  }

  /** Brings both layers up to date for `time` and says what to composite. */
  update(time: number): CaptionLayers {
    let staticKey = "";
    let activeKey = "";
    let activeShowing = false;
    const highlight = !!this.rs.highlight;
    const animation = this.rs.preset.animation;
    const showing: { cue: CaptionCue; index: number }[] = [];
    for (const cue of this.cues) {
      if (time < cue.start || time >= cue.end) continue;
      let index = -1;
      if (highlight) index = activeWordIndex(this.timingsFor(cue), time);
      showing.push({ cue, index });
      staticKey += `${cue.id}:${index}|`;
      if (index >= 0) {
        activeShowing = true;
        let step = "rest";
        if (animation) {
          const since = time - this.timingsFor(cue)[index].start;
          if (since < ANIMATION_SECONDS[animation]) step = String(Math.floor(since * ANIMATION_STEPS_PER_SECOND));
        }
        activeKey += `${cue.id}:${index}:${step}|`;
      }
    }
    if (!showing.length) return { static: null, active: null, band: this.band };

    const pad = effectPad(this.rs);
    if (staticKey !== this.staticKey) {
      const { ctx } = this.staticLayer;
      ctx.clearRect(0, this.band.top, this.frame.width, this.band.height);
      let extent: Rect | null = null;
      for (const { cue } of showing) {
        const layout = drawCue(ctx, cue, this.style, this.frame, time, { showTranslated: false, words: "static" });
        if (layout) extent = union(extent, { x: layout.bounds.x - pad, y: layout.bounds.y - pad, w: layout.bounds.w + pad * 2, h: layout.bounds.h + pad * 2 });
      }
      this.staticRect = toLayerRect(extent, this.band, this.frame.width);
      this.staticKey = staticKey;
      this.staticVersion += 1;
    }
    if (activeShowing && activeKey !== this.activeKey) {
      const { ctx } = this.activeLayer;
      ctx.clearRect(0, this.band.top, this.frame.width, this.band.height);
      let extent: Rect | null = null;
      for (const { cue, index } of showing) {
        if (index < 0) continue;
        const layout = drawCue(ctx, cue, this.style, this.frame, time, { showTranslated: false, words: "active" });
        if (layout) extent = union(extent, this.activeWordExtent(layout, index, pad));
      }
      this.activeRect = toLayerRect(extent, this.band, this.frame.width);
      this.activeKey = activeKey;
      this.activeVersion += 1;
    }
    return {
      static: { canvas: this.staticLayer.canvas, version: this.staticVersion, rect: this.staticRect },
      active: activeShowing ? { canvas: this.activeLayer.canvas, version: this.activeVersion, rect: this.activeRect } : null,
      band: this.band,
    };
  }

  /** The area the highlighted word can cover at any point of its animation (frame coordinates). */
  private activeWordExtent(layout: CueLayout, index: number, pad: number): Rect {
    const fontPx = layout.fontPx;
    for (const line of layout.lines) {
      for (const word of line.words) {
        if (word.index !== index) continue;
        const halfW = (word.w / 2) * MAX_ACTIVE_SCALE + pad + fontPx * 0.2;
        const halfH = fontPx * 0.65 * MAX_ACTIVE_SCALE + pad + fontPx * 0.2;
        const cx = word.x + word.w / 2;
        return { x: cx - halfW, y: word.y - halfH, w: halfW * 2, h: halfH * 2 };
      }
    }
    return { x: layout.bounds.x - pad, y: layout.bounds.y - pad, w: layout.bounds.w + pad * 2, h: layout.bounds.h + pad * 2 };
  }

  /** Draws the captions for `time` onto the frame canvas. */
  draw(ctx: Ctx, time: number) {
    const layers = this.update(time);
    if (layers.static) ctx.drawImage(layers.static.canvas, 0, layers.band.top);
    if (layers.active) ctx.drawImage(layers.active.canvas, 0, layers.band.top);
  }
}
