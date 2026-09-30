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
  type Frame,
  type ResolvedCaptionStyle,
} from "@/lib/captions/renderer";

/** How long the active-word animation runs (see activeWordScale). */
const ANIMATION_SECONDS = { pop: 0.18, bounce: 0.35 } as const;
/** The moving part is sampled at this rate, so a 30 fps export redraws the
 * active word every other frame during the animation, not every frame. */
const ANIMATION_STEPS_PER_SECOND = 20;

export type CaptionCanvas = OffscreenCanvas | HTMLCanvasElement;

export interface CaptionLayers {
  /** Static words. Null when no caption is showing. */
  static: { canvas: CaptionCanvas; version: number } | null;
  /** The highlighted word. Null when nothing is highlighted. */
  active: { canvas: CaptionCanvas; version: number } | null;
  /** Where the layers sit in the frame: they cover the full width and
   * only the horizontal band the captions can occupy. */
  band: { top: number; height: number };
}

/** Captions live around their anchor; the layers cover this much of the
 * frame height around it rather than the whole frame, which makes every
 * clear, raster and texture upload proportionally cheaper. */
const BAND_FRACTION = 0.5;

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
    let any = false;
    let activeShowing = false;
    const highlight = !!this.rs.highlight;
    const animation = this.rs.preset.animation;
    for (const cue of this.cues) {
      if (time < cue.start || time >= cue.end) continue;
      any = true;
      let index = -1;
      if (highlight) index = activeWordIndex(this.timingsFor(cue), time);
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
    if (!any) return { static: null, active: null, band: this.band };

    if (staticKey !== this.staticKey) {
      const { ctx } = this.staticLayer;
      ctx.clearRect(0, this.band.top, this.frame.width, this.band.height);
      for (const cue of this.cues) {
        if (time >= cue.start && time < cue.end) drawCue(ctx, cue, this.style, this.frame, time, { showTranslated: false, words: "static" });
      }
      this.staticKey = staticKey;
      this.staticVersion += 1;
    }
    if (activeShowing && activeKey !== this.activeKey) {
      const { ctx } = this.activeLayer;
      ctx.clearRect(0, this.band.top, this.frame.width, this.band.height);
      for (const cue of this.cues) {
        if (time >= cue.start && time < cue.end) drawCue(ctx, cue, this.style, this.frame, time, { showTranslated: false, words: "active" });
      }
      this.activeKey = activeKey;
      this.activeVersion += 1;
    }
    return {
      static: { canvas: this.staticLayer.canvas, version: this.staticVersion },
      active: activeShowing ? { canvas: this.activeLayer.canvas, version: this.activeVersion } : null,
      band: this.band,
    };
  }

  /** Draws the captions for `time` onto the frame canvas. */
  draw(ctx: Ctx, time: number) {
    const layers = this.update(time);
    if (layers.static) ctx.drawImage(layers.static.canvas, 0, layers.band.top);
    if (layers.active) ctx.drawImage(layers.active.canvas, 0, layers.band.top);
  }
}
