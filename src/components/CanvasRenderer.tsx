"use client";
/**
 * CanvasRenderer — the compositing surface of the editor.
 *
 * Every animation frame it advances the playback engine, composites the
 * video layer (native and GLSL/WebGL transitions), stickers, text and
 * captions through the shared Compositor, and reports the drawn element
 * rectangles so the parent can hit-test and draw selection handles.
 *
 * The same Compositor powers `captureFrames()` (frame-accurate offline
 * rendering at any fps, e.g. 60) used by the export pipeline, so the preview
 * and the encoded file always match.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import type { VideoProject } from "@/lib/models/project";
import type { ElementRect, Frame } from "@/lib/captions/renderer";
import type { EngineFrame } from "@/lib/playback/engine";
import { Compositor } from "@/lib/playback/compositor";

export { captureFrames, Compositor, needsCompositor } from "@/lib/playback/compositor";

let previewCanvas: HTMLCanvasElement | null = null;
/** The live preview canvas (for scopes and thumbnails). */
export function getPreviewCanvas(): HTMLCanvasElement | null {
  return previewCanvas;
}

export interface CanvasRendererHandle {
  /** Rectangles of the elements drawn in the last frame (frame pixels). */
  getRects(): ElementRect[];
  /** The canvas element, for coordinate mapping. */
  element(): HTMLCanvasElement | null;
}

export interface CanvasRendererProps {
  project: VideoProject;
  frame: Frame;
  cssWidth: number;
  cssHeight: number;
  /** Advances the clock and returns what to draw (e.g. engine.tick). */
  tick: () => EngineFrame;
  images: (assetId: string) => CanvasImageSource | undefined;
  onFrame?: (rects: ElementRect[], time: number) => void;
  className?: string;
}

export const CanvasRenderer = forwardRef<CanvasRendererHandle, CanvasRendererProps>(function CanvasRenderer(
  { project, frame, cssWidth, cssHeight, tick, images, onFrame, className },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rectsRef = useRef<ElementRect[]>([]);
  const projectRef = useRef(project);
  const onFrameRef = useRef(onFrame);
  const imagesRef = useRef(images);
  const compositorRef = useRef<Compositor | null>(null);

  useEffect(() => {
    projectRef.current = project;
    onFrameRef.current = onFrame;
    imagesRef.current = images;
  }, [project, onFrame, images]);

  useImperativeHandle(ref, () => ({ getRects: () => rectsRef.current, element: () => canvasRef.current }), []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!compositorRef.current) compositorRef.current = new Compositor(frame);
    const compositor = compositorRef.current;
    compositor.setFrame(frame);
    let raf = 0;
    const loop = () => {
      const f = tick();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pw = Math.max(1, Math.round(cssWidth * dpr));
      const ph = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw;
        canvas.height = ph;
      }
      ctx.setTransform(pw / frame.width, 0, 0, ph / frame.height, 0, 0);
      rectsRef.current = compositor.composite(ctx, projectRef.current, f, { images: imagesRef.current });
      previewCanvas = canvas;
      onFrameRef.current?.(rectsRef.current, f.time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cssWidth, cssHeight, frame, tick]);

  return <canvas ref={canvasRef} className={className} />;
});
