"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ZoomIn, ZoomOut, Maximize2, Music, Captions, Film, ArrowLeftRight, MessageSquare, AudioLines, Trash2 } from "lucide-react";
import { TransportBar } from "@/components/canvas/TransportBar";
import { useEditor } from "@/store/editorStore";
import { layoutClips, type ClipLayout } from "@/lib/models/timeline";
import type { CaptionCue, Clip } from "@/lib/models/project";
import { captionsClearedNotice, removeClip, reorderClip, splitClipAt, splitTarget } from "@/lib/models/clipOps";
import { playCutSound } from "@/lib/audio/uiSounds";
import { formatTime } from "@/lib/utils/time";
import { clamp } from "@/lib/utils/math";
import { musicLoops, musicSpan, setMusicSpan, setMusicStart } from "@/lib/models/musicTrim";
import { cx } from "@/lib/utils/cx";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Filmstrip, loadThumbs, type Loaded } from "./Filmstrip";
import { toSourceTime } from "@/lib/models/timeline";
import { stretchOf, type Slack } from "@/lib/edit/reelStretch";
import { AudioWaveform } from "./AudioWaveform";
import { useReelStretch, type InOut, type TrimDrag } from "./useReelStretch";
import { RULER_H, CUE_H, MUSIC_H, DOCK_CHROME_H, STRIP_OVERSCAN, drawRange, videoLaneHeight, visibleWindow } from "./dockLayout";

const EDGE = 7;
/** Below this width (px) a caption chip has no room for words: it is drawn as a plain bar. */
const CUE_LABEL_MIN_W = 30;
/** Vertical inset of a clip block inside the video lane. */
const CLIP_PAD = 4;
/** Pointer travel before a press on a clip body becomes a reorder drag. */
const DRAG_THRESHOLD = 8;
/** Pointer travel that turns a click on a clip into a drag, so it no longer cuts. */
const CLICK_SLOP = 3;

/** Whether a click at project time `t` (x px into the lane) would cut a clip: on a clip, clear of its trim handles. */
function cuttableAt(layouts: ClipLayout[], t: number, pxPerSec: number): ClipLayout | null {
  const target = splitTarget(layouts, t);
  if (!target) return null;
  const x = t * pxPerSec;
  if (x - target.start * pxPerSec <= EDGE || target.end * pxPerSec - x <= EDGE) return null;
  return target;
}

/** Insertion slot for a pointer at project time t: the number of clips whose middle lies before it. */
function insertionIndex(layouts: ClipLayout[], t: number): number {
  let k = 0;
  for (const l of layouts) if ((l.start + l.end) / 2 < t) k++;
  return k;
}

/**
 * Where the media and any stretched-out part sit inside a clip block `width`
 * px wide. While a reel's edge is dragged past its media, the block grows and
 * the part with no media yet is drawn as a ghost on that side.
 */
function stretchGeometry(clip: Clip, width: number, pxPerSec: number) {
  const st = stretchOf(clip);
  const left = Math.min(width, (st.before / clip.speed) * pxPerSec);
  const right = Math.min(width - left, (st.after / clip.speed) * pxPerSec);
  return { left, right, mediaW: Math.max(0, width - left - right), inPoint: Math.max(0, clip.inPoint), outPoint: Math.min(clip.duration, clip.outPoint), ...st };
}

/** Striped placeholder for the seconds a drag is pulling back from the source video. */
function StretchGhost({ side, width, seconds }: { side: "l" | "r"; width: number; seconds: number }) {
  return (
    <div
      className={cx("pointer-events-none absolute inset-y-0 flex items-center justify-center overflow-hidden text-[12px] font-semibold text-white", side === "l" ? "left-0" : "right-0")}
      style={{ width, backgroundImage: "repeating-linear-gradient(135deg, rgba(10,132,255,0.45) 0 5px, rgba(10,132,255,0.12) 5px 10px)" }}
      data-stretch-ghost={side}
      title="This part comes back from the source video when you let go"
    >
      {width > 40 && <span className="rounded bg-black/60 px-1 py-0.5 tabular-nums">+{seconds.toFixed(1)} s</span>}
    </div>
  );
}

/** Tooltip for a trim handle: how much can still be dragged out on that side. */
function handleTitle(seconds: number, side: "before" | "after"): string {
  return seconds > 0.05 ? `Drag out to bring back up to ${formatTime(seconds)} ${side} this` : "Drag to trim";
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
          {tick.major && <span className="absolute bottom-3 left-1 text-[12px] font-semibold leading-none tabular-nums text-white/75">{rulerLabel(tick.t, major < 1)}</span>}
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
  // Zoomed out, a caption is a few px wide: letters cut to "i…" mean nothing, a bar shows where speech is.
  const labelled = width >= CUE_LABEL_MIN_W;
  return (
    <div
      className={cx(
        "rf-read-face absolute top-1 flex h-[26px] cursor-grab items-center overflow-hidden border text-[13px] leading-none select-none",
        labelled ? "rounded-md px-1.5" : "rounded-[3px]",
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
      {labelled && <span className="truncate">{showTranslated && cue.translatedText ? cue.translatedText : cue.text}</span>}
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
  slack,
  onTrimEnd,
  onStretch,
  view,
  onCut,
  cutHover,
  onRemove,
  cutSide,
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
  /** On a reel: seconds of the source video the edges may be dragged out past the media on each side. Null: the edges stop at the media. */
  slack: Slack | null;
  /** An edge drag ended (inside its undo transaction); returns the in/out points to cut from the source when it went past the media. */
  onTrimEnd: (drag: TrimDrag) => InOut | null;
  /** Cuts the wider range from the source, after the transaction closed. */
  onStretch: (req: InOut) => void;
  /** Timeline range (px) being drawn: the filmstrip only gets a canvas for its part of it. */
  view: { from: number; to: number };
  /** A click (no drag) on the body at project time t: cut the clip there. */
  onCut: (t: number) => void;
  /** The pointer is over a spot a click would cut: the arrow replaces the grab hand. */
  cutHover: boolean;
  /** The trash button on the block was clicked: remove this clip. */
  onRemove: () => void;
  /** Set right after a cut on the half this block is: which way it pulls apart (see .rf-cut animations). */
  cutSide?: string;
}) {
  const { update, beginTransaction, endTransaction, select, setTool } = useEditor.getState();
  const { clip } = layout;
  const width = Math.max(6, layout.duration * pxPerSec);
  const blockH = laneH - CLIP_PAD * 2;
  const geo = stretchGeometry(clip, width, pxPerSec);
  const strip = visibleWindow(layout.start * pxPerSec + geo.left, geo.mediaW, view);
  // How much can still be dragged out on each side: the media's own slack, then the source past it.
  const availBefore = clip.inPoint + (slack?.before ?? 0);
  const availAfter = clip.duration - clip.outPoint + (slack?.after ?? 0);
  /** Hands a finished edge drag to the dock: where it began and where the edges are now (maybe past the media). */
  const finishTrim = (from: InOut): InOut | null => {
    const now = useEditor.getState().project?.clips.find((c) => c.id === clip.id);
    if (!now) return null;
    return onTrimEnd({ clipId: clip.id, from, to: { inPoint: now.inPoint, outPoint: now.outPoint } });
  };
  // The waveform keeps its 28-of-68 share of the block as the lane grows, within sane bounds.
  const drag = useRef<{ mode: "l" | "r" | "none" | "reorder"; startX: number; inPoint: number; outPoint: number; slot: number | null; onTag: boolean; wasSelected: boolean } | null>(null);
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
        "group absolute top-1 overflow-hidden rounded-lg border-2 bg-sys-gray6 select-none",
        dragging ? "cursor-grabbing opacity-60" : cutHover ? "cursor-default" : "cursor-grab",
        // Blue means selected: what Remove and Delete act on. The clip under the playhead only gets a faint outline.
        selected ? "border-sys-blue ring-2 ring-sys-blue/40" : active ? "border-white/30" : "border-sys-gray4",
      )}
      style={{ left: layout.start * pxPerSec, width, height: blockH }}
      data-clip={clip.id}
      data-cut={cutSide}
      onPointerDown={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const lx = e.clientX - r.left;
        const mode = lx < EDGE ? "l" : lx > r.width - EDGE ? "r" : "none";
        // Whether this press only selects: the first click on a clip selects it, the next one cuts.
        const wasSelected = selected;
        select({ kind: "clip", id: clip.id });
        // Where the press began: the block captures the pointer, so the release no longer says.
        drag.current = { mode, startX: e.clientX, inPoint: clip.inPoint, outPoint: clip.outPoint, slot: null, onTag: (e.target as Element).closest("[data-clip-tag]") !== null, wasSelected };
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
            // A reel's edges may run past its media into the source's slack; the ghost shows how far.
            if (d.mode === "l") c.inPoint = clamp(d.inPoint + dt, -(slack?.before ?? 0), d.outPoint - 0.1);
            else c.outPoint = clamp(d.outPoint + dt, d.inPoint + 0.1, c.duration + (slack?.after ?? 0));
          },
          // Captions and the rest follow the picture, measured from where the drag began.
          { history: false, ripple: true },
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
        if (!d) return;
        if (d.mode === "none") {
          // A click, not a drag: on a clip that was already selected, cut here. The first click only selects it.
          // Touch has no hover to show where, so it only selects. The name tag and a Shift / Option / ⌘ click only select.
          const selectOnly = !d.wasSelected || e.shiftKey || e.altKey || e.metaKey || d.onTag;
          if (!selectOnly && e.pointerType !== "touch" && e.button === 0 && Math.abs(e.clientX - d.startX) <= CLICK_SLOP) onCut(laneTime(e));
          return;
        }
        let stretch: InOut | null = null;
        if (d.mode === "reorder") {
          setDragging(false);
          onDropIndicator(null);
          if (d.slot !== null) {
            // Slot k counts the dragged clip itself when it sits before the slot.
            const to = d.slot > layout.index ? d.slot - 1 : d.slot;
            update((p) => void reorderClip(p, clip.id, to), { ripple: true });
          }
        } else stretch = finishTrim({ inPoint: d.inPoint, outPoint: d.outPoint });
        endTransaction();
        if (stretch) onStretch(stretch);
      }}
      onPointerCancel={() => {
        const d = drag.current;
        drag.current = null;
        if (d?.mode === "reorder") {
          setDragging(false);
          onDropIndicator(null);
        } else if (d && d.mode !== "none") finishTrim({ inPoint: d.inPoint, outPoint: d.outPoint });
        if (d && d.mode !== "none") endTransaction();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        setTool("trim");
      }}
    >
      <div className="absolute inset-y-0" style={{ left: geo.left, width: geo.mediaW }}>
        <Filmstrip assetId={clip.assetId} inPoint={geo.inPoint} outPoint={geo.outPoint} width={geo.mediaW} height={blockH} visible={strip} />
      </div>
      {geo.left > 0 && <StretchGhost side="l" width={geo.left} seconds={geo.before} />}
      {geo.right > 0 && <StretchGhost side="r" width={geo.right} seconds={geo.after} />}
      <div
        className="absolute left-1 top-1 flex cursor-pointer items-center gap-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[12px] font-semibold text-white hover:bg-black/85 hover:ring-1 hover:ring-white/40"
        data-clip-tag={clip.id}
        title="Select this clip. Click the clip once to select it, and click it again where you want to cut."
      >
        <span className="max-w-32 truncate">{clip.name}</span>
        <span className="text-white/70">{formatTime(layout.duration)}</span>
        {clip.speed !== 1 && <span className="text-sys-yellow">{clip.speed}×</span>}
      </div>
      {layout.transitionOut > 0 && (
        <div className="absolute bottom-1 right-1 flex items-center gap-0.5 rounded bg-sys-purple/80 px-1 text-[11px] text-white" title={`${clip.transition.type} ${clip.transition.duration}s`}>
          <ArrowLeftRight size={9} /> {clip.transition.type}
        </div>
      )}
      {width >= 44 && (
        <button
          type="button"
          className={cx(
            "absolute right-2 top-1 z-10 flex h-6 w-6 items-center justify-center rounded-md bg-black/70 text-white/85 shadow transition-opacity hover:bg-sys-red hover:text-white focus-visible:opacity-100",
            selected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
          title="Remove this clip"
          aria-label={`Remove ${clip.name}`}
          data-clip-remove={clip.id}
          // Its own press: no select, no drag, no cut.
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
      <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30" title={handleTitle(availBefore, "before")} data-trim-handle="l" />
      <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize bg-white/0 hover:bg-white/30" title={handleTitle(availAfter, "after")} data-trim-handle="r" />
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
      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[12px] tabular-nums text-white">{formatTime(time)}</span>
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
  // Reels: the clip's edges may be dragged out past the media; a release out there cuts more from the source.
  const stretch = useReelStretch();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(800);
  // Where the strips were last drawn from. They cover STRIP_OVERSCAN px past the viewport on each
  // side, so the dock re-renders only once the scroll has used up half of that margin.
  const [scrollX, setScrollX] = useState(0);
  const drawnAt = useRef(0);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const x = e.currentTarget.scrollLeft;
    if (Math.abs(x - drawnAt.current) > STRIP_OVERSCAN / 2) {
      drawnAt.current = x;
      setScrollX(x);
    }
  };
  const view = drawRange(scrollX, viewW);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = zoom;
  const music = project.music;
  /** The whole song from its start offset: drawn in full, even past the end of the video. */
  const songLen = music ? musicSpan(music) : 0;
  /** What the export uses: the song stops where the video ends (looped to fill it when Loop is on). */
  const musicUsed = music ? (musicLoops(music) ? duration : Math.min(duration, songLen)) : 0;
  const musicShown = music ? Math.max(musicUsed, songLen) : 0;
  const contentW = Math.max(viewW, Math.max(duration, musicShown) * pxPerSec + 160);
  // The audio lane matches the video lane, so waveforms read at the same scale as the filmstrip.
  const audioH = videoH;
  const lanesH = RULER_H + CUE_H + videoH + audioH + MUSIC_H;
  // Fit the video; with no video yet, fit the song.
  const fit = () => {
    const len = duration > 0 ? duration : musicShown;
    setZoom(len > 0 ? (viewW - 80) / len : 80);
  };
  // Music added to a project with no video yet: zoom out so the whole song is on screen, not just its first seconds.
  const musicAssetId = music?.assetId ?? null;
  useEffect(() => {
    if (musicAssetId && duration === 0) fit();
    // Only when a song is added: not when the video changes or the window resizes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [musicAssetId]);
  const scrubbing = useRef(false);
  const [hover, setHover] = useState<{ x: number; time: number; layout: ClipLayout; cut: boolean } | null>(null);
  const update = useEditor((s) => s.update);
  const setNotice = useEditor((s) => s.setNotice);
  /** The cut just made, for the flash, the "Cut" label and the pull-apart of its two halves; cleared after the animation. */
  const [cutFx, setCutFx] = useState<{ n: number; x: number; time: number; left: string; right: string } | null>(null);
  const cutCount = useRef(0);
  const cutSideOf = (id: string) => (cutFx?.left === id ? `l${cutFx.n % 2}` : cutFx?.right === id ? `r${cutFx.n % 2}` : undefined);
  useEffect(() => {
    if (!cutFx) return;
    const id = setTimeout(() => setCutFx(null), 1700);
    return () => clearTimeout(id);
  }, [cutFx]);
  /** Splits the clip under project time t (a click on the video or audio lane), with a snip. */
  const cutAt = (t: number) => {
    const target = stretch.job ? null : cuttableAt(layouts, t, pxPerSec);
    if (!target) return;
    let newId: string | null = null;
    update((p) => void (newId = splitClipAt(p, t)));
    if (!newId) return;
    playCutSound();
    setCutFx({ n: ++cutCount.current, x: t * pxPerSec, time: t, left: target.clip.id, right: newId });
    seek(t);
    setHover(null);
    setNotice(`Cut at ${formatTime(t)}. To remove a piece, hover it and click its trash button. Undo takes the cut back.`);
  };
  /** The trash button on a clip block: remove that clip and close the gap. */
  const removeAt = (id: string) => {
    let cleared = 0;
    update((p) => void (cleared = removeClip(p, id).clearedCaptions), { ripple: true });
    select(null);
    setHover(null);
    setNotice(cleared ? captionsClearedNotice(cleared) : "Removed the clip. Undo brings it back.");
  };
  const [dropX, setDropX] = useState<number | null>(null);
  /** clientX where a press on an audio block began, so a click (not a drag) cuts. */
  const audioPress = useRef<number | null>(null);
  /** Whether the audio block pressed was already selected: the first click selects, the next one cuts. */
  const audioWasSelected = useRef(false);
  /** A drag on the music block's left or right edge: how long the block was and where its trims stood. */
  const musicDrag = useRef<{ mode: "l" | "r"; startX: number; shown: number; startOffset: number } | null>(null);
  const { beginTransaction, endTransaction } = useEditor.getState();
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


  return (
    <div className="card flex shrink-0 flex-col overflow-hidden" style={{ height: DOCK_CHROME_H + lanesH }}>
      <TransportBar />
      <div className="flex h-[30px] items-center gap-2 border-b border-sys-gray5 px-3 text-[13px] text-white/70">
        <span className="font-semibold text-white">Timeline</span>
        <span className="tabular-nums">{formatTime(duration)}</span>
        <span className="text-label-3">·</span>
        <span>
          {project.clips.length} {project.clips.length === 1 ? "clip" : "clips"} · {project.cues.length} {project.cues.length === 1 ? "caption" : "captions"}
        </span>
        {stretch.job && (
          <span className="flex min-w-0 items-center gap-2" data-stretch-job>
            <span className="text-label-3">·</span>
            <span className="w-24 shrink-0">
              <ProgressBar value={stretch.job.progress} />
            </span>
            <span className="truncate text-white">{stretch.job.message}</span>
            <button type="button" className="rounded px-1 text-label-2 hover:text-white" onClick={stretch.cancel}>
              Cancel
            </button>
          </span>
        )}
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
        <div className="flex w-24 shrink-0 flex-col border-r border-sys-gray5 text-[12px] font-semibold uppercase tracking-wide text-label-2">
          <div style={{ height: RULER_H }} />
          <div className="flex items-center gap-1 px-2" style={{ height: CUE_H }}>
            <Captions size={13} /> Captions
          </div>
          <div className="flex items-center gap-1 px-2" style={{ height: videoH }}>
            <Film size={13} /> Video
          </div>
          <div className="flex items-center gap-1 px-2" style={{ height: audioH }}>
            <AudioLines size={13} /> Audio
          </div>
          <div className="flex items-center gap-1 px-2" style={{ height: MUSIC_H }}>
            <Music size={13} /> Music
          </div>
        </div>
        <div
          ref={scrollRef}
          className="relative flex-1 overflow-x-auto overflow-y-hidden"
          onScroll={onScroll}
          onPointerDown={onBackgroundDown}
          onPointerMove={(e) => {
            if (scrubbing.current) seek(timeAt(e.clientX));
            const el = e.currentTarget;
            const r = el.getBoundingClientRect();
            const y = e.clientY - r.top;
            // The video lane and the audio lane under it: both show where a click would cut.
            const inClipLanes = y >= RULER_H + CUE_H && y <= RULER_H + CUE_H + videoH + audioH;
            if (!inClipLanes || e.pointerType === "touch") {
              if (hover) setHover(null);
              return;
            }
            const t = (e.clientX - r.left + el.scrollLeft) / pxPerSec;
            const l = layouts.find((l) => t >= l.start && t < l.end);
            if (!l) {
              if (hover) setHover(null);
              return;
            }
            const overButton = (e.target as Element).closest?.("[data-clip-remove], [data-clip-tag]") !== null;
            const cut = !overButton && selection?.kind === "clip" && selection.id === l.clip.id && !e.shiftKey && !e.altKey && !e.metaKey && !scrubbing.current && dropX === null && !stretch.job && e.buttons === 0 && cuttableAt(layouts, t, pxPerSec) !== null;
            setHover({ x: t * pxPerSec, time: t, layout: l, cut });
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
                  className="absolute inset-x-1 top-1 flex h-[26px] items-center justify-center gap-2 rounded-md border border-sys-gray4 bg-sys-gray5 rf-read-face text-[14px] text-white/80 hover:bg-sys-gray4 hover:text-white"
                  style={{ width: Math.max(0, contentW - 8) }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => setTool("subtitles")}
                >
                  <MessageSquare size={14} />
                  <span>
                    <b className="font-semibold text-white">No subtitles yet.</b> Click here, then press Generate captions.
                  </span>
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
                  slack={stretch.job ? null : stretch.slack}
                  onTrimEnd={stretch.finishTrim}
                  onStretch={stretch.start}
                  view={view}
                  onCut={cutAt}
                  cutHover={!!hover?.cut && hover.layout.clip.id === layout.clip.id}
                  onRemove={() => removeAt(layout.clip.id)}
                  cutSide={cutSideOf(layout.clip.id)}
                />
              ))}
              {dropX !== null && <div className="pointer-events-none absolute inset-y-0 z-30 w-0.5 -translate-x-1/2 bg-sys-blue shadow-[0_0_6px_rgba(10,132,255,0.9)]" data-drop-indicator style={{ left: dropX }} />}
            </div>
            {/* Clip audio on its own lane: one waveform block per clip, aligned with its video block. */}
            <div className="relative border-b border-sys-gray5/70" style={{ height: audioH }} data-audio-lane>
              {layouts.map((layout) => {
                if (!layout.clip.hasAudio) return null;
                const w = Math.max(6, layout.duration * pxPerSec);
                const geo = stretchGeometry(layout.clip, w, pxPerSec);
                const strip = visibleWindow(layout.start * pxPerSec + geo.left, geo.mediaW, view);
                return (
                  <div
                    key={layout.clip.id}
                    data-audio-clip={layout.clip.id}
                    data-cut={cutSideOf(layout.clip.id)}
                    className={cx(
                      "absolute top-1 cursor-pointer overflow-hidden rounded-md border bg-sys-yellow/10",
                      selection?.kind === "clip" && selection.id === layout.clip.id ? "border-sys-blue" : "border-sys-yellow/30",
                    )}
                    style={{ left: layout.start * pxPerSec, width: w, height: audioH - 8 }}
                    title={`${layout.clip.name} audio${layout.clip.audioAssetId ? ` (${layout.clip.audioLabel ?? "cleaned"})` : ""}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      audioWasSelected.current = selection?.kind === "clip" && selection.id === layout.clip.id;
                      select({ kind: "clip", id: layout.clip.id });
                      audioPress.current = e.clientX;
                    }}
                    onPointerUp={(e) => {
                      const from = audioPress.current;
                      audioPress.current = null;
                      if (from === null || !audioWasSelected.current || e.pointerType === "touch" || e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || Math.abs(e.clientX - from) > CLICK_SLOP) return;
                      const lane = e.currentTarget.parentElement!;
                      cutAt((e.clientX - lane.getBoundingClientRect().left) / pxPerSec);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setTool("trim");
                    }}
                  >
                    <div className="absolute inset-y-0" style={{ left: geo.left, width: geo.mediaW }}>
                      <AudioWaveform assetId={layout.clip.audioAssetId ?? layout.clip.assetId} inPoint={geo.inPoint} outPoint={geo.outPoint} width={geo.mediaW} height={audioH - 8} color="rgba(255,214,10,0.9)" visible={strip} />
                    </div>
                    {geo.left > 0 && <StretchGhost side="l" width={geo.left} seconds={geo.before} />}
                    {geo.right > 0 && <StretchGhost side="r" width={geo.right} seconds={geo.after} />}
                  </div>
                );
              })}
            </div>
            <div className="relative" style={{ height: MUSIC_H }}>
              {project.voiceovers.map((vo) => (
                <div
                  key={vo.id}
                  className={cx(
                    "absolute top-1 z-10 flex h-5 cursor-pointer items-center overflow-hidden rounded-md border border-sys-orange/60 bg-sys-orange/25 px-1.5 text-[12px] text-white",
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
                  className="absolute top-1 h-5 cursor-pointer overflow-hidden rounded-md border border-sys-green/50 bg-sys-green/15 text-[12px] text-white"
                  style={{
                    width: Math.max(6, musicShown * pxPerSec),
                    // Fades sit on the part the export uses, which ends with the video.
                    backgroundImage: `linear-gradient(to right, rgba(16,185,129,0.05) 0, rgba(16,185,129,0.35) ${music.fadeIn * pxPerSec}px, rgba(16,185,129,0.35) ${Math.max(music.fadeIn, musicUsed - music.fadeOut) * pxPerSec}px, rgba(16,185,129,0.05) ${musicUsed * pxPerSec}px, rgba(16,185,129,0.05) 100%)`,
                  }}
                  title={`${music.name} · ${formatTime(songLen)} · drag an edge to trim`}
                  data-music-block
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    setTool("music");
                    const r = e.currentTarget.getBoundingClientRect();
                    const lx = e.clientX - r.left;
                    const mode = lx < EDGE ? "l" : lx > r.width - EDGE ? "r" : null;
                    if (!mode) return;
                    musicDrag.current = { mode, startX: e.clientX, shown: musicShown, startOffset: music.startOffset };
                    beginTransaction();
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    const d = musicDrag.current;
                    if (!d) return;
                    const dt = (e.clientX - d.startX) / pxPerSec;
                    update(
                      (p) => {
                        const m = p.music;
                        if (!m) return;
                        if (d.mode === "l") setMusicStart(m, d.startOffset + dt);
                        else setMusicSpan(m, d.shown + dt);
                      },
                      { history: false },
                    );
                  }}
                  onPointerUp={(e) => {
                    if (!musicDrag.current) return;
                    musicDrag.current = null;
                    endTransaction();
                    try {
                      e.currentTarget.releasePointerCapture(e.pointerId);
                    } catch {
                      /* not captured */
                    }
                  }}
                  onPointerCancel={() => {
                    if (!musicDrag.current) return;
                    musicDrag.current = null;
                    endTransaction();
                  }}
                >
                  <div className="absolute inset-y-0 left-0 z-10 w-[7px] cursor-col-resize touch-none bg-white/40 hover:bg-white/70" data-music-handle="l" />
                  <div className="absolute inset-y-0 right-0 z-10 w-[7px] cursor-col-resize touch-none bg-white/40 hover:bg-white/70" data-music-handle="r" />
                  {musicShown > musicUsed + 0.05 && (
                    <div
                      className="pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end overflow-hidden pr-2"
                      style={{ left: musicUsed * pxPerSec, backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.5) 0 5px, rgba(0,0,0,0.25) 5px 10px)" }}
                      data-music-unused
                    >
                      {(musicShown - musicUsed) * pxPerSec > 260 && (
                        <span className="rf-read-face truncate rounded bg-black/60 px-1.5 text-[12px] text-white/80">{duration > 0 ? "Past the end of the video · not in the export" : "Plays under your video once you add one"}</span>
                      )}
                    </div>
                  )}
                  <div className="relative flex h-full items-center gap-1 px-1.5">
                    <Music size={10} className="shrink-0" />
                    <span className="truncate">{music.name}</span>
                    <span className="shrink-0 tabular-nums text-white/60">{formatTime(songLen)}</span>
                  </div>
                </div>
              )}
            </div>
            {/* Where a click would cut: a thin line through the video and audio lanes, notched at both ends. */}
            {hover?.cut && (
              <div className="pointer-events-none absolute z-20 w-0" style={{ left: hover.x, top: RULER_H + CUE_H + CLIP_PAD, height: videoH + audioH - CLIP_PAD * 2 }} data-cut-indicator>
                <div className="absolute inset-y-0 -left-px w-px bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.45)]" />
                <div className="absolute -left-[4px] top-0 h-0 w-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-white" />
                <div className="absolute -left-[4px] bottom-0 h-0 w-0 border-x-[4px] border-b-[5px] border-x-transparent border-b-white" />
              </div>
            )}
            {/* The cut just made: a bright line along it and a label, so a click is never silent. */}
            {cutFx && (
              <div key={cutFx.n} className="pointer-events-none absolute z-30 w-0" style={{ left: cutFx.x, top: RULER_H + CUE_H + CLIP_PAD, height: videoH + audioH - CLIP_PAD * 2 }} data-cut-fx>
                <div className="rf-cut-flash absolute inset-y-0 -left-[2px] w-1 rounded-full bg-white shadow-[0_0_14px_3px_rgba(255,255,255,0.9),0_0_0_1px_rgba(0,0,0,0.5)]" data-cut-flash />
                <div className="rf-cut-pop absolute left-0 flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/30 bg-black/85 px-3 py-1 text-[13px] font-semibold text-white shadow-xl" style={{ top: videoH / 2 }} data-cut-pill>
                  <span className="h-2 w-2 rounded-full bg-sys-red" /> Cut · <span className="tabular-nums">{formatTime(cutFx.time)}</span>
                </div>
              </div>
            )}
            <Playhead pxPerSec={pxPerSec} scrollRef={scrollRef} height={lanesH} />
          </div>
        </div>
      </div>
    </div>
  );
}
