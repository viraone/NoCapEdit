"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { GripHorizontal } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { cx } from "@/lib/utils/cx";
import { DOCK_DEFAULT_H, DOCK_MAX_H, DOCK_MIN_H } from "./dockLayout";

/** Height change per arrow-key press when the handle is focused. */
const KEY_STEP = 16;

/** The grip between the preview and the timeline: pull it up for a taller timeline, down for a shorter one. */
export function TimelineResizeHandle() {
  const height = useEditor((s) => s.timelineHeight);
  const setHeight = useEditor((s) => s.setTimelineHeight);
  const drag = useRef<{ startY: number; startH: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  // One cursor and no text selection anywhere while the grip is held, even with the pointer over the preview.
  useEffect(() => {
    if (!dragging) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursor;
      document.body.style.userSelect = userSelect;
    };
  }, [dragging]);

  const finish = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* not captured */
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize timeline"
      aria-valuemin={DOCK_MIN_H}
      aria-valuemax={DOCK_MAX_H}
      aria-valuenow={height}
      tabIndex={0}
      title="Drag to resize the timeline · double-click to reset"
      data-timeline-resize
      className={cx(
        "group relative flex h-3 shrink-0 cursor-row-resize touch-none select-none items-center justify-center outline-none transition-colors",
        dragging ? "text-sys-blue" : "text-sys-gray2 hover:text-white focus-visible:text-sys-blue",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        drag.current = { startY: e.clientY, startH: height };
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        // Pulling the grip up grows the timeline; the store clamps to the lane and window limits.
        setHeight(d.startH + (d.startY - e.clientY));
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onDoubleClick={() => setHeight(DOCK_DEFAULT_H)}
      onKeyDown={(e) => {
        if (e.key === "ArrowUp") setHeight(height + KEY_STEP);
        else if (e.key === "ArrowDown") setHeight(height - KEY_STEP);
        else return;
        e.preventDefault();
      }}
    >
      {/* Wider hit area than the 12 px row, so the grip is easy to catch. */}
      <span className="absolute inset-x-0 -inset-y-1.5" aria-hidden />
      <span
        className={cx(
          "absolute inset-x-0 top-1/2 h-px -translate-y-1/2 transition-opacity",
          dragging ? "bg-sys-blue/60 opacity-100" : "bg-white/15 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
        )}
        aria-hidden
      />
      <span className="relative bg-[#0b0b0d] px-1">
        <GripHorizontal size={16} />
      </span>
    </div>
  );
}
