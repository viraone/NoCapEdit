"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Film, Play } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import type { ElementRect, Frame, Rect } from "@/lib/captions/renderer";
import { CanvasRenderer } from "@/components/CanvasRenderer";
import { getFormat, SAFE_ZONES } from "@/lib/models/formats";
import { layoutClips, locateFrame } from "@/lib/models/timeline";
import { clamp } from "@/lib/utils/math";
import { Button } from "@/components/ui/Button";
import { SafeZoneGuide } from "./SafeZoneGuide";

type DragKind = "move" | "resize" | "pan";
interface DragState {
  kind: DragKind;
  id: string | null;
  elKind: "overlay" | "cue" | null;
  startX: number;
  startY: number;
  origin: { x: number; y: number; size: number; rect: Rect | null };
  alt: boolean;
  moved: boolean;
}
interface Guide {
  axis: "x" | "y";
  pos: number;
}

function snap(values: number[], lines: number[], threshold: number): { delta: number; guide: number } | null {
  let best: { delta: number; guide: number } | null = null;
  for (const v of values) {
    for (const g of lines) {
      const d = g - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, guide: g };
    }
  }
  return best;
}

export function VideoCanvas() {
  const project = useEditor((s) => s.project)!;
  const tool = useEditor((s) => s.tool);
  const selection = useEditor((s) => s.selection);
  const canvasZoom = useEditor((s) => s.canvasZoom);
  const assetUrls = useEditor((s) => s.assetUrls);
  const update = useEditor((s) => s.update);
  const select = useEditor((s) => s.select);
  const setTool = useEditor((s) => s.setTool);
  const beginTransaction = useEditor((s) => s.beginTransaction);
  const endTransaction = useEditor((s) => s.endTransaction);

  const format = getFormat(project.formatId);
  const fw = format.width;
  const fh = format.height;
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = useMemo(() => {
    if (canvasZoom !== "fit") return canvasZoom;
    if (!size.w || !size.h) return 0.1;
    return Math.max(0.02, Math.min((size.w - 32) / fw, (size.h - 32) / fh));
  }, [canvasZoom, size, fw, fh]);
  const cssW = fw * scale;
  const cssH = fh * scale;

  const projectRef = useRef(project);
  const rectsRef = useRef<ElementRect[]>([]);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  useEffect(() => {
    for (const ov of project.overlays) {
      if (ov.kind !== "image") continue;
      const url = assetUrls[ov.assetId];
      if (!url || imagesRef.current.has(ov.assetId)) continue;
      const img = new Image();
      img.src = url;
      imagesRef.current.set(ov.assetId, img);
    }
  }, [project.overlays, assetUrls]);
  const getImage = useCallback((id: string) => {
    const img = imagesRef.current.get(id);
    return img && img.complete && img.naturalWidth ? img : undefined;
  }, []);

  const [selRect, setSelRect] = useState<Rect | null>(null);
  const selRectRef = useRef<Rect | null>(null);
  const selectionRef = useRef(selection);
  useEffect(() => {
    projectRef.current = project;
    selectionRef.current = selection;
  }, [project, selection]);

  const frame = useMemo<Frame>(() => ({ width: fw, height: fh }), [fw, fh]);
  const tick = useCallback(() => engine.tick(), []);
  const onFrame = useCallback((rects: ElementRect[]) => {
    rectsRef.current = rects;
    const sel = selectionRef.current;
    let next: Rect | null = null;
    if (sel && sel.kind !== "clip") next = rects.find((r) => r.id === sel.id)?.rect ?? null;
    const prev = selRectRef.current;
    const changed =
      (!prev && next) ||
      (prev && !next) ||
      (prev && next && (Math.abs(prev.x - next.x) > 0.5 || Math.abs(prev.y - next.y) > 0.5 || Math.abs(prev.w - next.w) > 0.5 || Math.abs(prev.h - next.h) > 0.5));
    if (changed) {
      selRectRef.current = next;
      setSelRect(next);
    }
  }, []);

  const [guides, setGuides] = useState<Guide[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const guideLines = useMemo(() => {
    const xs = [fw / 2];
    const ys = [fh / 2];
    if (project.safeZone !== "none") {
      const z = SAFE_ZONES[project.safeZone];
      xs.push(z.left * fw, (1 - z.right) * fw);
      ys.push(z.top * fh, (1 - z.bottom) * fh);
    }
    return { xs, ys };
  }, [fw, fh, project.safeZone]);

  const toFrame = (clientX: number, clientY: number) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  };
  const hitTest = (x: number, y: number): ElementRect | null => {
    const rects = rectsRef.current;
    for (let i = rects.length - 1; i >= 0; i--) {
      const r = rects[i].rect;
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return rects[i];
    }
    return null;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const p = toFrame(e.clientX, e.clientY);
    const hit = hitTest(p.x, p.y);
    const proj = projectRef.current;
    if (hit) {
      const kind = hit.kind === "cue" ? "cue" : "overlay";
      select({ kind, id: hit.id });
      let origin = { x: 0, y: 0, size: 1, rect: hit.rect as Rect | null };
      if (hit.kind === "overlay") {
        const ov = proj.overlays.find((o) => o.id === hit.id);
        if (ov) origin = { x: ov.track ? ov.track.offset.x : ov.x, y: ov.track ? ov.track.offset.y : ov.y, size: ov.kind === "text" ? ov.fontSize : ov.width, rect: hit.rect };
      } else {
        const cue = proj.cues.find((c) => c.id === hit.id);
        const a = cue?.anchor ?? { x: proj.subtitleStyle.x, y: proj.subtitleStyle.y };
        origin = { x: a.x, y: a.y, size: proj.subtitleStyle.sizeScale, rect: hit.rect };
      }
      dragRef.current = { kind: "move", id: hit.id, elKind: kind, startX: e.clientX, startY: e.clientY, origin, alt: e.altKey, moved: false };
      beginTransaction();
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "trim" && proj.clips.length) {
      const loc = locateFrame(layoutClips(proj.clips), engine.time);
      if (loc) {
        const clip = loc.primary.clip;
        select({ kind: "clip", id: clip.id });
        dragRef.current = { kind: "pan", id: clip.id, elKind: null, startX: e.clientX, startY: e.clientY, origin: { x: clip.pan.x, y: clip.pan.y, size: clip.zoom, rect: null }, alt: false, moved: false };
        beginTransaction();
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      return;
    }
    select(null);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    if (Math.abs(dx) + Math.abs(dy) > 1) d.moved = true;

    if (d.kind === "pan") {
      update(
        (p) => {
          const c = p.clips.find((c) => c.id === d.id);
          if (c) {
            c.pan.x = clamp(d.origin.x + dx / fw, -1, 1);
            c.pan.y = clamp(d.origin.y + dy / fh, -1, 1);
          }
        },
        { history: false },
      );
      return;
    }
    if (d.kind === "resize") {
      const r = d.origin.rect;
      if (!r) return;
      const factor = clamp((r.w + dx) / Math.max(1, r.w), 0.1, 10);
      update(
        (p) => {
          if (d.elKind === "overlay") {
            const ov = p.overlays.find((o) => o.id === d.id);
            if (!ov) return;
            if (ov.kind === "text") ov.fontSize = clamp(d.origin.size * factor, 0.01, 0.3);
            else ov.width = clamp(d.origin.size * factor, 0.02, 3);
          } else {
            p.subtitleStyle.sizeScale = clamp(d.origin.size * factor, 0.3, 3);
          }
        },
        { history: false },
      );
      return;
    }

    let mx = dx;
    let my = dy;
    const found: Guide[] = [];
    const r = d.origin.rect;
    if (r && !e.shiftKey) {
      const thr = 8 / scale;
      const sx = snap([r.x + mx + r.w / 2, r.x + mx, r.x + mx + r.w], guideLines.xs, thr);
      if (sx) {
        mx += sx.delta;
        found.push({ axis: "x", pos: sx.guide });
      }
      const sy = snap([r.y + my + r.h / 2, r.y + my, r.y + my + r.h], guideLines.ys, thr);
      if (sy) {
        my += sy.delta;
        found.push({ axis: "y", pos: sy.guide });
      }
    }
    setGuides(found);
    update(
      (p) => {
        if (d.elKind === "overlay") {
          const ov = p.overlays.find((o) => o.id === d.id);
          if (ov) {
            if (ov.track) {
              ov.track.offset.x = clamp(d.origin.x + mx / fw, -1, 1);
              ov.track.offset.y = clamp(d.origin.y + my / fh, -1, 1);
            } else {
              ov.x = clamp(d.origin.x + mx / fw, -0.5, 1.5);
              ov.y = clamp(d.origin.y + my / fh, -0.5, 1.5);
            }
          }
        } else if (d.elKind === "cue") {
          const cue = p.cues.find((c) => c.id === d.id);
          if (!cue) return;
          const nx = clamp(d.origin.x + mx / fw, 0, 1);
          const ny = clamp(d.origin.y + my / fh, 0, 1);
          if (d.alt || cue.anchor) cue.anchor = { x: nx, y: ny };
          else {
            p.subtitleStyle.x = nx;
            p.subtitleStyle.y = ny;
          }
        }
      },
      { history: false },
    );
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setGuides([]);
    endTransaction();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = toFrame(e.clientX, e.clientY);
    const hit = hitTest(p.x, p.y);
    if (!hit) {
      engine.toggle();
      return;
    }
    if (hit.kind === "cue") setTool("subtitles");
    else {
      const ov = projectRef.current.overlays.find((o) => o.id === hit.id);
      setTool(ov?.kind === "image" ? "picture" : "text");
    }
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const sel = selectionRef.current;
    const r = selRectRef.current;
    if (!sel || !r || sel.kind === "clip") return;
    const proj = projectRef.current;
    let sizeValue = proj.subtitleStyle.sizeScale;
    if (sel.kind === "overlay") {
      const ov = proj.overlays.find((o) => o.id === sel.id);
      if (ov) sizeValue = ov.kind === "text" ? ov.fontSize : ov.width;
    }
    dragRef.current = { kind: "resize", id: sel.id, elKind: sel.kind, startX: e.clientX, startY: e.clientY, origin: { x: 0, y: 0, size: sizeValue, rect: r }, alt: false, moved: false };
    beginTransaction();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const selectionLabel = selection?.kind === "cue" ? "Caption" : selection?.kind === "overlay" ? "Overlay" : "";
  const isPlaying = useEditor((s) => s.isPlaying);

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
      <div ref={canvasRef} className="relative shrink-0 overflow-hidden rounded-2xl shadow-2xl shadow-black/60" style={{ width: cssW, height: cssH }}>
        <CanvasRenderer project={project} frame={frame} cssWidth={cssW} cssHeight={cssH} tick={tick} images={getImage} onFrame={onFrame} className="block h-full w-full bg-black" />
        <SafeZoneGuide kind={project.safeZone} />
        {guides.map((g, i) => (
          <div
            key={i}
            className="pointer-events-none absolute bg-sys-teal"
            style={g.axis === "x" ? { left: g.pos * scale, top: 0, width: 1, height: "100%" } : { top: g.pos * scale, left: 0, height: 1, width: "100%" }}
          />
        ))}
        <div
          className="absolute inset-0 touch-none"
          style={{ cursor: tool === "trim" ? "grab" : "default" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          {!isPlaying && project.clips.length > 0 && (
            <button
              type="button"
              aria-label="Play"
              className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-transform hover:scale-105"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                engine.play();
              }}
            >
              <Play size={28} className="ml-1" fill="currentColor" />
            </button>
          )}
          <span className="pointer-events-none absolute bottom-2 right-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white/90">{format.ratio}</span>
          {selRect && (
            <div
              className="pointer-events-none absolute border border-brand-400"
              style={{ left: selRect.x * scale, top: selRect.y * scale, width: selRect.w * scale, height: selRect.h * scale }}
            >
              <span className="absolute -top-5 left-0 rounded bg-brand-500 px-1 text-[10px] text-white">{selectionLabel}</span>
              <div
                className="pointer-events-auto absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-brand-400 bg-sys-gray6"
                onPointerDown={startResize}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
          )}
        </div>
        {project.clips.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl bg-sys-gray6 text-center text-label-2">
            <Film size={36} className="text-sys-gray3" />
            <p className="text-[13px]">Import a recording to start</p>
            <Button variant="primary" size="sm" className="pointer-events-auto" onClick={() => setTool("clips")}>
              Add clips
            </Button>
          </div>
        )}
      </div>
      {tool === "trim" && project.clips.length > 0 && (
        <p className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-md bg-sys-gray6/90 px-2 py-1 text-[11px] text-label-2">
          Drag the video to pan · use the Trim panel to zoom
        </p>
      )}
    </div>
  );
}
