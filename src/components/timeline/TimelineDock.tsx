"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ZoomIn, ZoomOut, Maximize2, Music, Captions, Film, ArrowLeftRight, MessageSquare } from "lucide-react";
import { TransportBar } from "@/components/canvas/TransportBar";
import { useEditor } from "@/store/editorStore";
import { layoutClips, type ClipLayout } from "@/lib/models/timeline";
import type { CaptionCue } from "@/lib/models/project";
import { reorderClip } from "@/lib/models/clipOps";
import { formatTime } from "@/lib/utils/time";
import { clamp } from "@/lib/utils/math";
import { cx } from "@/lib/utils/cx";
import { Button } from "@/components/ui/Button";
import { Filmstrip, loadThumbs, type Loaded } from "./Filmstrip";
import { toSourceTime } from "@/lib/models/timeline";
import { AudioWaveform } from "./AudioWaveform";
import { RULER_H, CUE_H, MUSIC_H, DOCK_CHROME_H, videoLaneHeight } from "./dockLayout";

const EDGE = 7;
/** Vertical inset of a clip block inside the video lane. */
const CLIP_PAD = 4;
/** Pointer travel before a press on a clip body becomes a reorder drag. */
const DRAG_THRESHOLD = 8;

/** Insertion slot for a pointer at project time t: the number of clips whose middle lies before it. */
function insertionIndex(layouts: ClipLayout[], t: number): number {
  let k = 0;
  for (const l of layouts) if ((l.start + l.end) / 2 < t) k++;
  return k;
}

function rulerLabel(t: number, fine: boolean): string {
  if (fine) return formatTime(t, true);
  if (t < 60) return `${Math.round(t)}s`;
  return formatTime(t, false);
}

function Ruler({ pxPerSec, duration, width }: { pxPerSec: number; duration: number; width: number }) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const major = steps.find((s) => s * pxPerSec >= 72) ?? 600;
  const minor = major / (major >= 1 ? 4 : 2);
  const ticks: { t: number; major: boolean }[] = [];
  const end = Math.max(duration, width / pxPerSec);
  for (let t = 0; t <= end + 1e-6; t += minor) {
    const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
    ticks.push({ t: Math.round(t * 1000) / 1000, major: isMajor });
  }
  return (
    <div className="relative border-b border-sys-gray5" style={{ height: RULER_H }}>
      {ticks.map((tick) => (
        <div key={tick.t} className="absolute bottom-0" style={{ left: tick.t * pxPerSec }}>
          <div className={cx("w-px bg-sys-gray3", tick.major ? "h-3" : "h-1.5")} />
          {tick.major && <span className="absolute bottom-3 left-1 text-[10px] font-semibold tabular-nums text-label-2">{rulerLabel(tick.t, major < 1)}</span>}
        </div>
      ))}
    </div>
  );
}

function Playhead({ pxPerSec, scrollRef, height }: { pxPerSec: number; scrollRef: React.RefObject<HTMLDivElement | null>; height: number }) {
  const currentTime = useEditor((s) => s.currentTime);
  const isPlaying = useEditor((s) => s.isPlaying);
  const seek = useEditor((s) => s.seek);
  const x = currentTime * pxPerSec;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying) return;
    const view = el.clientWidth;
    if (x < el.scrollLeft || x > el.scrollLeft + view - 24) el.scrollLeft = Math.max(0, x - view * 0.15);
  }, [x, isPlaying, scrollRef]);
  const dragging = useRef(false);
  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return (clientX - r.left + el.scrollLeft) / pxPerSec;
  };
  return (
    <div
      className="absolute top-0 z-20 w-0"
      style={{ left: x, height }}
      onPointerDown={(e) => {
        e.stopPropagation();
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => dragging.current && seek(timeAt(e.clientX))}
      onPointerUp={(e) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    >
      <div className="absolute -left-2 top-0 h-3 w-4 cursor-ew-resize rounded-b-sm bg-sys-blue" />
      <div className="absolute left-0 top-0 h-full w-px bg-sys-blue" />
    </div>
  );
}

function CueBlock({ cue, pxPerSec, selected, active, showTranslated }: { cue: CaptionCue; pxPerSec: number; selected: boolean; active: boolean; showTranslated: boolean }) {
  const { update, beginTransaction, endTransaction, select, seek, setTool } = useEditor.getState();
  const drag = useRef<{ mode: "move" | "l" | "r"; startX: number; start: number; end: number; moved: boolean } | null>(null);
  const width = Math.max(4, (cue.end - cue.start) * pxPerSec);
  return (
    <div
      className={cx(
        "absolute top-1 flex h-[26px] cursor-grab items-center overflow-hidden rounded-md border px-1.5 text-[11px] leading-none select-none",
        active ? "border-sys-blue bg-sys-blue/30 text-white" : "border-sys-teal/50 bg-sys-teal/15 text-white",
        selected && "ring-1 ring-sys-blue",
      )}
      style={{ left: cue.start * pxPerSec, width }}
      title={cue.text}
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const lx = e.clientX - r.left;
        const mode = lx < EDGE ? "l" : lx > r.width - EDGE ? "r" : "move";
        drag.current = { mode, startX: e.clientX, start: cue.start, end: cue.end, moved: false };
        select({ kind: "cue", id: cue.id });
        beginTransaction();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dt = (e.clientX - d.startX) / pxPerSec;
        if (Math.abs(e.clientX - d.startX) > 2) d.moved = true;
        update(
          (p) => {
            const c = p.cues.find((c) => c.id === cue.id);
            if (!c) return;
            if (d.mode === "move") {
              const shift = Math.max(-d.start, dt);
              c.start = d.start + shift;
              c.end = d.end + shift;
              c.words = c.words?.map((w) => ({ ...w, start: w.start + (c.start - cue.start), end: w.end + (c.start - cue.start) }));
            } else if (d.mode === "l") c.start = clamp(d.start + dt, 0, d.end - 0.1);
            else c.end = Math.max(d.start + 0.1, d.end + dt);
          },
          { history: false },
        );
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        endTransaction();
        e.currentTarget.releasePointerCapture(e.pointerId);
        if (d && !d.moved) seek(cue.start);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setTool("subtitles");
      }}
    >
      <span className="truncate">{showTranslated && cue.translatedText ? cue.translatedText : cue.text}</span>
      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
    </div>
  );
}

function ClipBlock({
  layout,
  layouts,
  pxPerSec,
  laneH,
  selected,
  active,
  onDropIndicator,
}: {
  layout: ClipLayout;
  layouts: ClipLayout[];
  pxPerSec: number;
  /** Height of the video lane; the block fills it minus CLIP_PAD on each side. */
  laneH: number;
  selected: boolean;
  active: boolean;
  /** x (px) of the insertion slot while a reorder drag is in progress, null when none. */
  onDropIndicator: (x: number | null) => void;
}) {
  const { update, beginTransaction, endTransaction, select, setTool } = useEditor.getState();
  const { clip } = layout;
  const width = Math.max(6, layout.duration * pxPerSec);
  const blockH = laneH - CLIP_PAD * 2;
  // The waveform keeps its 28-of-68 share of the block as the lane grows, within sane bounds.
  const waveH = clamp(Math.round(blockH * 0.41), 16, 56);
  const drag = useRef<{ mode: "l" | "r" | "none" | "reorder"; startX: number; inPoint: number; outPoint: number; slot: number | null } | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Project time under the pointer, measured against the lane so scrolling is accounted for. */
  const laneTime = (e: React.PointerEvent<HTMLDivElement>) => {
    const lane = e.currentTarget.parentElement!;
    return (e.clientX - lane.getBoundingClientRect().left) / pxPerSec;
  };
  const slotX = (k: number) => (k < layouts.length ? layouts[k].start : layouts[layouts.length - 1].end) * pxPerSec;
  return (
    <div
      className={cx(
        "absolute top-1 overflow-hidden rounded-lg border-2 bg-sys-gray6 select-none",
        dragging ? "cursor-grabbing opacity-60" : "cursor-grab",
        selected || active ? "border-sys-blue" : "border-sys-gray4",
      )}
      style={{ left: layout.start * pxPerSec, width, height: blockH }}
      data-clip={clip.id}
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const lx = e.clientX - r.left;
        const mode = lx < EDGE ? "l" : lx > r.width - EDGE ? "r" : "none";
        select({ kind: "clip", id: clip.id });
        drag.current = { mode, startX: e.clientX, inPoint: clip.inPoint, outPoint: clip.outPoint, slot: null };
        e.currentTarget.setPointerCapture(e.pointerId);
        if (mode !== "none") beginTransaction();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (d.mode === "none") {
          if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
          // Past the threshold a press on the body becomes a reorder drag (one undo step).
          d.mode = "reorder";
          beginTransaction();
          setDragging(true);
        }
        if (d.mode === "reorder") {
          const k = insertionIndex(layouts, laneTime(e));
          d.slot = k;
          onDropIndicator(slotX(k));
          return;
        }
        const dt = ((e.clientX - d.startX) / pxPerSec) * clip.speed;
        update(
          (p) => {
            const c = p.clips.find((c) => c.id === clip.id);
            if (!c) return;
            if (d.mode === "l") c.inPoint = clamp(d.inPoint + dt, 0, d.outPoint - 0.1);
            else c.outPoint = clamp(d.outPoint + dt, d.inPoint + 0.1, c.duration);
          },
          { history: false },
        );
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* not captured */
        }
        if (!d || d.mode === "none") return;
        if (d.mode === "reorder") {
          setDragging(false);
          onDropIndicator(null);
          if (d.slot !== null) {
            // Slot k counts the dragged clip itself when it sits before the slot.
            const to = d.slot > layout.index ? d.slot - 1 : d.slot;
            update((p) => void reorderClip(p, clip.id, to));
          }
        }
        endTransaction();
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.mode === "reorder") {
          setDragging(false);
          onDropIndicator(null);
        }
        if (d && d.mode !== "none") endTransaction();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setTool("trim");
      }}
    >
      <Filmstrip assetId={clip.assetId} inPoint={clip.inPoint} outPoint={clip.outPoint} width={width} height={blockH} />
      {clip.hasAudio && <AudioWaveform assetId={clip.assetId} inPoint={clip.inPoint} outPoint={clip.outPoint} width={width} height={waveH} color="rgba(255,214,10,0.9)" />}
      <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-black/60 px-1 py-0.5 text-[10px] font-semibold text-white">
        <span className="max-w-32 truncate">{clip.name}</span>
        <span className="text-label-2">{formatTime(layout.duration)}</span>
        {clip.speed !== 1 && <span className="text-sys-yellow">{clip.speed}×</span>}
      </div>
      {layout.transitionOut > 0 && (
        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-sys-purple/80 px-1 text-[9px] text-white" title={`${clip.transition.type} ${clip.transition.duration}s`}>
          <ArrowLeftRight size={9} /> {clip.transition.type}
        </div>
      )}
      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30" />
      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30" />
    </div>
  );
}

/** Floating frame preview while hovering the video lane. */
function HoverPreview({ x, time, layout }: { x: number; time: number; layout: ClipLayout }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbs, setThumbs] = useState<Loaded | null>(null);
  useEffect(() => {
    let alive = true;
    loadThumbs(layout.clip.assetId).then((t) => alive && setThumbs(t));
    return () => {
      alive = false;
    };
  }, [layout.clip.assetId]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !thumbs) return;
    const { img, rec } = thumbs;
    const w = 160;
    const h = Math.round((rec.frameHeight / rec.frameWidth) * w);
    canvas.width = w;
    canvas.height = h;
    const st = toSourceTime(layout, time);
    const idx = Math.max(0, Math.min(rec.count - 1, Math.floor((st / Math.max(0.001, rec.duration)) * rec.count)));
    canvas.getContext("2d")?.drawImage(img, idx * rec.frameWidth, 0, rec.frameWidth, rec.frameHeight, 0, 0, w, h);
  }, [thumbs, time, layout]);
  if (!thumbs) return null;
  return (
    <div className="pointer-events-none absolute z-30 -translate-x-1/2 overflow-hidden rounded-lg border border-sys-gray3 bg-black shadow-xl" style={{ left: x, bottom: "100%", marginBottom: 6 }}>
      <canvas ref={canvasRef} className="block" />
      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] tabular-nums text-white">{formatTime(time)}</span>
    </div>
  );
}

export function TimelineDock() {
  const project = useEditor((s) => s.project)!;
  const zoom = useEditor((s) => s.timelineZoom);
  const setZoom = useEditor((s) => s.setTimelineZoom);
  const videoH = useEditor((s) => videoLaneHeight(s.timelineHeight));
  const selection = useEditor((s) => s.selection);
  const seek = useEditor((s) => s.seek);
  const select = useEditor((s) => s.select);
  const setTool = useEditor((s) => s.setTool);
  const hasCues = project.cues.length > 0;
  const activeCueId = useEditor((s) => {
    const t = s.currentTime;
    return s.project?.cues.find((c) => t >= c.start && t < c.end)?.id ?? null;
  });
  const activeClipId = useEditor((s) => {
    if (!s.project) return null;
    const t = s.currentTime;
    const layouts = layoutClips(s.project.clips);
    let id: string | null = null;
    for (const l of layouts) if (t >= l.start) id = l.clip.id;
    return id;
  });

  const layouts = useMemo(() => layoutClips(project.clips), [project.clips]);
  const duration = layouts.length ? layouts[layouts.length - 1].end : 0;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = zoom;
  const contentW = Math.max(viewW, duration * pxPerSec + 160);
  const lanesH = RULER_H + CUE_H + videoH + MUSIC_H;
  const fit = () => setZoom(duration > 0 ? (viewW - 80) / duration : 80);
  const scrubbing = useRef(false);
  const [hover, setHover] = useState<{ x: number; time: number; layout: ClipLayout } | null>(null);
  const [dropX, setDropX] = useState<number | null>(null);
  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left + el.scrollLeft) / pxPerSec, 0, duration);
  };
  const onBackgroundDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    scrubbing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    select(null);
    seek(timeAt(e.clientX));
  };

  const music = project.music;
  const musicWidth = music ? (music.loop ? duration : Math.min(duration, Math.max(0, music.duration - music.startOffset))) * pxPerSec : 0;

  return (
    <div className="card flex shrink-0 flex-col overflow-hidden" style={{ height: DOCK_CHROME_H + lanesH }}>
      <TransportBar />
      <div className="flex h-[30px] items-center gap-2 border-b border-sys-gray5 px-3 text-[11px] text-label-2">
        <span className="font-semibold text-white">Timeline</span>
        <span className="tabular-nums">{formatTime(duration)}</span>
        <span className="text-label-3">·</span>
        <span>{project.clips.length} clips · {project.cues.length} captions</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="iconSm" onClick={() => setZoom(zoom / 1.4)} title="Zoom out">
            <ZoomOut size={14} />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={() => setZoom(zoom * 1.4)} title="Zoom in">
            <ZoomIn size={14} />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={fit} title="Fit timeline">
            <Maximize2 size={14} />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex w-20 shrink-0 flex-col border-r border-sys-gray5 text-[10px] uppercase tracking-wide text-label-3">
          <div style={{ height: RULER_H }} />
          <div className="flex items-center gap-1 px-2" style={{ height: CUE_H }}>
            <Captions size={11} /> Captions
          </div>
          <div className="flex items-center gap-1 px-2" style={{ height: videoH }}>
            <Film size={11} /> Video
          </div>
          <div className="flex items-center gap-1 px-2" style={{ height: MUSIC_H }}>
            <Music size={11} /> Music
          </div>
        </div>
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-x-auto overflow-y-hidden"
          onPointerDown={onBackgroundDown}
          onPointerMove={(e) => {
            if (scrubbing.current) seek(timeAt(e.clientX));
            const el = e.currentTarget;
            const r = el.getBoundingClientRect();
            const y = e.clientY - r.top;
            const inVideoLane = y >= RULER_H + CUE_H && y <= RULER_H + CUE_H + videoH;
            if (!inVideoLane || e.pointerType === "touch") {
              if (hover) setHover(null);
              return;
            }
            const t = (e.clientX - r.left + el.scrollLeft) / pxPerSec;
            const l = layouts.find((l) => t >= l.start && t < l.end);
            if (!l) {
              if (hover) setHover(null);
              return;
            }
            setHover({ x: t * pxPerSec, time: t, layout: l });
          }}
          onPointerLeave={() => setHover(null)}
          onPointerUp={(e) => {
            scrubbing.current = false;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
        >
          <div className="relative" style={{ width: contentW, height: lanesH }}>
            <Ruler pxPerSec={pxPerSec} duration={duration} width={contentW} />
            <div className="relative border-b border-sys-gray5/70" style={{ height: CUE_H }}>
              {!hasCues && (
                <button
                  type="button"
                  className="absolute inset-x-1 top-1 flex h-[26px] items-center justify-center gap-2 rounded-md border border-sys-gray4 bg-sys-gray5 text-[12px] font-semibold text-label-2 hover:bg-sys-gray4 hover:text-white"
                  style={{ width: Math.max(0, contentW - 8) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setTool("subtitles")}
                >
                  <MessageSquare size={13} /> No subtitles yet — click here, then press Generate captions
                </button>
              )}
              {project.cues.map((cue) => (
                <CueBlock
                  key={cue.id}
                  cue={cue}
                  pxPerSec={pxPerSec}
                  selected={selection?.kind === "cue" && selection.id === cue.id}
                  active={activeCueId === cue.id}
                  showTranslated={project.captions.showTranslated}
                />
              ))}
            </div>
            <div className="relative border-b border-sys-gray5/70" style={{ height: videoH }}>
              {hover && dropX === null && <HoverPreview x={hover.x} time={hover.time} layout={hover.layout} />}
              {layouts.map((layout) => (
                <ClipBlock
                  key={layout.clip.id}
                  layout={layout}
                  layouts={layouts}
                  pxPerSec={pxPerSec}
                  laneH={videoH}
                  selected={selection?.kind === "clip" && selection.id === layout.clip.id}
                  active={activeClipId === layout.clip.id}
                  onDropIndicator={setDropX}
                />
              ))}
              {dropX !== null && <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-sys-blue shadow-[0_0_6px_rgba(10,132,255,0.9)]" data-drop-indicator style={{ left: dropX }} />}
            </div>
            <div className="relative" style={{ height: MUSIC_H }}>
              {project.voiceovers.map((vo) => (
                <div
                  key={vo.id}
                  className={cx(
                    "absolute top-1 z-10 flex h-5 cursor-pointer items-center overflow-hidden rounded-md border border-sys-orange/60 bg-sys-orange/25 px-1 text-[10px] text-white",
                    selection?.kind === "voiceover" && selection.id === vo.id && "ring-1 ring-sys-blue",
                  )}
                  style={{ left: vo.start * pxPerSec, width: Math.max(6, vo.duration * pxPerSec) }}
                  title={vo.text}
                  data-voiceover-block={vo.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    select({ kind: "voiceover", id: vo.id });
                    seek(vo.start);
                    setTool("music");
                  }}
                >
                  <span className="truncate">{vo.kind === "sfx" ? "🔔" : "🎙"} {vo.name}</span>
                </div>
              ))}
              {music && (
                <div
                  className="absolute top-1 flex h-5 cursor-pointer items-center overflow-hidden rounded-md border border-sys-green/50 bg-sys-green/15 px-1.5 text-[10px] text-white"
                  style={{
                    width: Math.max(6, musicWidth),
                    backgroundImage: `linear-gradient(to right, rgba(16,185,129,0.05) 0, rgba(16,185,129,0.35) ${music.fadeIn * pxPerSec}px, rgba(16,185,129,0.35) calc(100% - ${music.fadeOut * pxPerSec}px), rgba(16,185,129,0.05) 100%)`,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setTool("music");
                  }}
                >
                  <Music size={10} className="mr-1 shrink-0" /> <span className="truncate">{music.name}</span>
                </div>
              )}
            </div>
            <Playhead pxPerSec={pxPerSec} scrollRef={scrollRef} height={lanesH} />
          </div>
        </div>
      </div>
    </div>
  );
}
