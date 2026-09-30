/**
 * Cached caption compositing for the exporters.
 *
 * drawCue() lays the words out and paints stroke/shadow/fill passes — fine
 * once, expensive thirty times a second at 1080p on a phone. But a caption
 * only *looks* different when the spoken word changes, or while the active
 * word is mid-animation (the pop/bounce looks). So the captions are
 * rendered onto their own transparent layer, keyed by that state, and each
 * frame just blits the layer unless the key changed.
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
const ANIMATION_STEPS_PER_SECOND = 20;

export class CaptionLayer {
  private readonly layer: OffscreenCanvas | HTMLCanvasElement;
  private readonly layerCtx: Ctx;
  private readonly rs: ResolvedCaptionStyle;
  private readonly timings = new Map<string, WordTiming[]>();
  private key = "";
  /** How many times the captions were actually re-rendered (vs. blitted). */
  renders = 0;

  constructor(
    private readonly cues: CaptionCue[],
    private readonly style: SubtitleStyle,
    private readonly frame: Frame,
  ) {
    if (typeof OffscreenCanvas !== "undefined") {
      this.layer = new OffscreenCanvas(frame.width, frame.height);
    } else {
      const c = document.createElement("canvas");
      c.width = frame.width;
      c.height = frame.height;
      this.layer = c;
    }
    const ctx = this.layer.getContext("2d") as Ctx | null;
    if (!ctx) throw new Error("Canvas is not available.");
    this.layerCtx = ctx;
    this.rs = resolveCaptionStyle(style, frame);
  }

  private timingsFor(cue: CaptionCue): WordTiming[] {
    let t = this.timings.get(cue.id);
    if (!t) {
      t = wordTimingsFor(cue, tokenize(cueDisplayText(cue, false)));
      this.timings.set(cue.id, t);
    }
    return t;
  }

  /** Everything about a cue's appearance that can change over time. */
  private stateKey(cue: CaptionCue, time: number): string {
    if (!this.rs.highlight) return cue.id;
    const timings = this.timingsFor(cue);
    const index = activeWordIndex(timings, time);
    if (index < 0) return `${cue.id}:-`;
    const animation = this.rs.preset.animation;
    if (!animation) return `${cue.id}:${index}`;
    const since = time - timings[index].start;
    // Mid-animation the word is moving; afterwards it sits still. The
    // moving part is sampled at ANIMATION_STEPS_PER_SECOND so a 30 fps
    // export redraws the layer every other frame during the 0.2–0.35 s
    // pop/bounce, not every frame.
    return since >= ANIMATION_SECONDS[animation] ? `${cue.id}:${index}:rest` : `${cue.id}:${index}:${Math.floor(since * ANIMATION_STEPS_PER_SECOND)}`;
  }

  /** The transparent layer holding the current captions. */
  get canvas(): OffscreenCanvas | HTMLCanvasElement {
    return this.layer;
  }

  /** Brings the layer up to date for `time`. Returns whether any caption
   * is showing; `renders` bumps when the layer was actually redrawn. */
  update(time: number): boolean {
    let key = "";
    let any = false;
    for (const cue of this.cues) {
      if (time >= cue.start && time < cue.end) {
        any = true;
        key += `${this.stateKey(cue, time)}|`;
      }
    }
    if (!any) return false;
    if (key !== this.key) {
      this.layerCtx.clearRect(0, 0, this.frame.width, this.frame.height);
      for (const cue of this.cues) {
        if (time >= cue.start && time < cue.end) drawCue(this.layerCtx, cue, this.style, this.frame, time, { showTranslated: false });
      }
      this.key = key;
      this.renders += 1;
    }
    return true;
  }

  /** Draws the captions for `time` onto the frame canvas. */
  draw(ctx: Ctx, time: number) {
    if (this.update(time)) ctx.drawImage(this.layer, 0, 0);
  }
}
