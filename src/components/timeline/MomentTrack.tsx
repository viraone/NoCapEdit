"use client";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { useEditor } from "@/store/editorStore";
import { useRecap } from "@/lib/recap/recapStore";
import { engine } from "@/lib/playback/engine";
import { playStep, resizePiece, type MomentEdit } from "@/lib/recap/momentEdits";
import { clamp } from "@/lib/utils/math";
import { cx } from "@/lib/utils/cx";
import { CUE_H, RULER_H } from "./dockLayout";
import { activeMoment, useActiveMoment } from "./useActiveMoment";

interface MomentTrackProps {
  pxPerSec: number;
  /** Length of the project (s): no piece may grow past it. */
  duration: number;
  /** Full content width of the timeline (px). */
  width: number;
  /** The video lane plus the audio lane under it (px). */
  height: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

function samePieces(a: MomentEdit, b: MomentEdit): boolean {
  if (a.pieces.length !== b.pieces.length) return false;
  return a.pieces.every((p, i) => p.start === b.pieces[i].start && p.end === b.pieces[i].end);
}

/**
 * While a moment from the Recap panel is open, this covers the video and audio
 * lanes: the clips underneath take no pointer events, and the moment's pieces
 * can be dragged, selected and played over gaps. It never edits the project.
 */
export function MomentTrack({ pxPerSec, duration, width, height, scrollRef }: MomentTrackProps) {
  const moment = useActiveMoment();
  const selected = useRecap((s) => s.selectedPiece);
  const id = moment?.laugh.id ?? null;
  const drag = useRef<{ index: number; side: "start" | "end"; before: MomentEdit; moved: boolean } | null>(null);
  /** The zoom and scroll before the moment opened, put back when it closes. */
  const savedView = useRef<{ zoom: number; scrollLeft: number } | null>(null);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return clamp((clientX - r.left + el.scrollLeft) / pxPerSec, 0, duration);
  };

  // Opening a moment zooms its pieces (plus 6 s on each side) to the visible width; closing puts the view back.
  useEffect(() => {
    const el = scrollRef.current;
    const m = id ? activeMoment() : null;
    if (!m) {
      const saved = savedView.current;
      if (!saved) return;
      savedView.current = null;
      const editor = useEditor.getState();
      editor.setTimelineZoom(saved.zoom);
      if (el) requestAnimationFrame(() => (el.scrollLeft = saved.scrollLeft));
      return;
    }
    if (!savedView.current) {
      savedView.current = { zoom: useEditor.getState().timelineZoom, scrollLeft: el?.scrollLeft ?? 0 };
    }
    const pieces = m.edit.pieces;
    const start = pieces.length ? Math.min(...pieces.map((p) => p.start)) : m.laugh.start;
    const end = pieces.length ? Math.max(...pieces.map((p) => p.end)) : m.laugh.end;
    const zoom = clamp((el?.clientWidth ?? 800) / (Math.max(0.1, end - start) + 12), 1, 600);
    const editor = useEditor.getState();
    editor.setTimelineZoom(zoom);
    editor.select(null);
    editor.seek(Math.max(0, start));
    requestAnimationFrame(() => {
      const node = scrollRef.current;
      if (node) node.scrollLeft = Math.max(0, (start - 6) * zoom);
    });
  }, [id, scrollRef]);

  // Playing a moment skips its gaps and stops at its last piece. Playback started outside it is left alone.
  useEffect(() => {
    if (!id) return;
    let wasPlaying = false;
    let follow = false;
    let stopped = false;
    return useEditor.subscribe(({ currentTime, isPlaying }) => {
      if (!isPlaying) {
        wasPlaying = false;
        stopped = false;
        return;
      }
      if (!wasPlaying) {
        wasPlaying = true;
        const m = activeMoment();
        const pieces = m?.edit.pieces ?? [];
        follow = pieces.length > 0 && currentTime >= pieces[0].start - 0.5 && currentTime <= pieces[pieces.length - 1].end + 0.5;
        return;
      }
      if (!follow || stopped) return;
      const m = activeMoment();
      if (!m) return;
      const step = playStep(m.edit, currentTime);
      if (step === "pause") {
        stopped = true;
        engine.pause();
      } else if (step) {
        useEditor.getState().seek(step.seek);
      }
    });
  }, [id]);

  if (!moment) return null;
  const pieces = moment.edit.pieces;

  const onPieceDown = (e: ReactPointerEvent<HTMLDivElement>, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useRecap.getState().selectPiece(index);
    useEditor.getState().seek(timeAt(e.clientX));
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLDivElement>, index: number, side: "start" | "end") => {
    if (e.button !== 0) return;
    const m = activeMoment();
    if (!m) return;
    e.stopPropagation();
    e.preventDefault();
    drag.current = { index, side, before: m.edit, moved: false };
    useRecap.getState().selectPiece(index);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    e.stopPropagation();
    const m = activeMoment();
    if (!m) return;
    const recap = useRecap.getState();
    const next = resizePiece(recap.edits[m.laugh.id] ?? d.before, d.index, d.side, timeAt(e.clientX), m.duration);
    if (!d.moved) {
      if (samePieces(next, d.before)) return;
      d.moved = true;
      recap.pushHistory(d.before);
    }
    recap.setEdit(m.laugh.id, next);
    const piece = next.pieces[d.index];
    if (!piece) return;
    // Show the frame at the edge being dragged; an end edge a hair before it, so its last frame is in view.
    useEditor.getState().seek(d.side === "start" ? piece.start : Math.max(piece.start, piece.end - 0.05));
  };

  const onHandleUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  return (
    // Same layer as the Playhead, which is drawn after this and so stays on top of it.
    <div className="absolute z-20" style={{ left: 0, top: RULER_H + CUE_H, width, height }} data-moment-track>
      {/* Everywhere outside the pieces is dimmed; a press here bubbles to the dock and scrubs as usual. */}
      <div className="absolute inset-0 bg-black/60" data-moment-dim />
      {pieces.map((piece, index) => {
        const pieceW = Math.max(4, (piece.end - piece.start) * pxPerSec);
        const isSelected = selected === index;
        return (
          <div
            key={index}
            data-moment-piece={index}
            className={cx(
              "absolute top-1 bottom-1 touch-none select-none overflow-hidden bg-sys-orange/20",
              isSelected ? "border-4 border-white" : "border-2 border-sys-orange",
            )}
            style={{ left: piece.start * pxPerSec, width: pieceW }}
            onPointerDown={(e) => onPieceDown(e, index)}
          >
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center px-3 text-[12px] font-semibold tabular-nums text-white">
              {(piece.end - piece.start).toFixed(1)} s
            </span>
            <div
              role="presentation"
              data-moment-handle="start"
              className="absolute inset-y-0 left-0 z-10 w-[14px] cursor-ew-resize touch-none border-r border-black/30 bg-sys-orange/80 hover:bg-sys-orange"
              onPointerDown={(e) => onHandleDown(e, index, "start")}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
            />
            <div
              role="presentation"
              data-moment-handle="end"
              className="absolute inset-y-0 right-0 z-10 w-[14px] cursor-ew-resize touch-none border-l border-black/30 bg-sys-orange/80 hover:bg-sys-orange"
              onPointerDown={(e) => onHandleDown(e, index, "end")}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
            />
          </div>
        );
      })}
    </div>
  );
}
