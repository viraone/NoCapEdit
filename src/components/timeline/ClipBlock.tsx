"use client";
import { useRef, useState } from "react";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import type { Clip } from "@/lib/models/project";
import type { ClipLayout } from "@/lib/models/timeline";
import { reorderClip } from "@/lib/models/clipOps";
import { formatTime } from "@/lib/utils/time";
import { clamp } from "@/lib/utils/math";
import { stretchOf, type Slack } from "@/lib/edit/reelStretch";
import { cx } from "@/lib/utils/cx";
import { focusModality } from "@/components/editor/spaceShortcut";
import { Filmstrip } from "./Filmstrip";
import { visibleWindow } from "./dockLayout";
import type { InOut, TrimDrag } from "./useReelStretch";
import { CLICK_SLOP, CLIP_PAD, EDGE } from "./laneConstants";

/** Pointer travel before a press on a clip body becomes a reorder drag. */
const DRAG_THRESHOLD = 8;

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
export function stretchGeometry(clip: Clip, width: number, pxPerSec: number) {
  const st = stretchOf(clip);
  const left = Math.min(width, (st.before / clip.speed) * pxPerSec);
  const right = Math.min(width - left, (st.after / clip.speed) * pxPerSec);
  return { left, right, mediaW: Math.max(0, width - left - right), inPoint: Math.max(0, clip.inPoint), outPoint: Math.min(clip.duration, clip.outPoint), ...st };
}

/** Striped placeholder for the seconds a drag is pulling back from the source video. */
export function StretchGhost({ side, width, seconds }: { side: "l" | "r"; width: number; seconds: number }) {
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

export function ClipBlock({
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
        "group absolute top-1 overflow-hidden rounded-lg border-2 bg-sys-gray6 select-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        dragging ? "cursor-grabbing opacity-60" : cutHover ? "cursor-default" : "cursor-grab",
        // Blue means selected: what Remove and Delete act on. The clip under the playhead only gets a faint outline.
        selected ? "border-sys-blue ring-2 ring-sys-blue/40" : active ? "border-white/30" : "border-sys-gray4",
      )}
      style={{ left: layout.start * pxPerSec, width, height: blockH }}
      data-clip={clip.id}
      data-cut={cutSide}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`Clip ${clip.name}, ${formatTime(layout.duration)} long`}
      onKeyDown={(e) => {
        // The trash button inside keeps its own keys.
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " " && e.code !== "Space") return;
        // Space after a click stays play/pause; Space from the keyboard selects this clip.
        if ((e.key === " " || e.code === "Space") && focusModality.isPointerFocused()) return;
        e.preventDefault();
        select({ kind: "clip", id: clip.id });
      }}
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
        title="Select this clip, then click again to cut where you click."
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
      <span className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize bg-white/0 hover:bg-white/30" title={handleTitle(availBefore, "before")} data-trim-handle="l" />
      <span className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize bg-white/0 hover:bg-white/30" title={handleTitle(availAfter, "after")} data-trim-handle="r" />
    </div>
  );
}
