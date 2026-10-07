"use client";
import { useRef, useState } from "react";
import { Music, Trash2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import type { MusicTrack } from "@/lib/models/project";
import { applyMusicPieces, headTo, musicLayout, musicPieces, musicSpan, removeMusicPiece, splitMusicAt, tailTo, type MusicPiece } from "@/lib/models/musicTrim";
import { playCutSound } from "@/lib/audio/uiSounds";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";

const EDGE = 7;
const CLICK_SLOP = 3;

/**
 * The music on the timeline: one green block per piece of the song. Drag the outer edges to trim,
 * click a piece to select it and click it again to cut it there, and use its trash button to remove it.
 */
export function MusicLane({ music, pxPerSec, shown, used, duration }: { music: MusicTrack; pxPerSec: number; shown: number; used: number; duration: number }) {
  const root = useRef<HTMLDivElement>(null);
  const [sel, setSel] = useState<number | null>(null);
  /** Pointer x within the lane while over the selected piece: where a click would cut. */
  const [cutX, setCutX] = useState<number | null>(null);
  const drag = useRef<{ mode: "l" | "r"; startX: number; pieces: MusicPiece[]; shown: number } | null>(null);
  const press = useRef<{ index: number; wasSelected: boolean; startX: number } | null>(null);

  const layout = musicLayout(music);
  const last = layout.length - 1;
  const cut = layout.length > 1;
  const selected = sel !== null && sel <= last ? sel : null;
  const songLen = musicSpan(music);
  const fadeIn = music.fadeIn * pxPerSec;
  const fadeOutAt = Math.max(music.fadeIn, used - music.fadeOut) * pxPerSec;
  const shownPx = Math.max(6, shown * pxPerSec);
  const gradient = `linear-gradient(to right, rgba(16,185,129,0.05) 0, rgba(16,185,129,0.35) ${fadeIn}px, rgba(16,185,129,0.35) ${fadeOutAt}px, rgba(16,185,129,0.05) ${used * pxPerSec}px, rgba(16,185,129,0.05) 100%)`;

  const timeAt = (clientX: number) => (clientX - root.current!.getBoundingClientRect().left) / pxPerSec;

  const cutAt = (t: number) => {
    const { update, setNotice } = useEditor.getState();
    const probe = structuredClone(music);
    if (!splitMusicAt(probe, t)) return;
    update((p) => void (p.music && splitMusicAt(p.music, t)));
    playCutSound();
    setCutX(null);
    setNotice(`Cut the music at ${formatTime(t)}. To remove a piece, click it and press its trash button. Undo takes the cut back.`);
  };

  const removePiece = (index: number) => {
    const { update, setNotice } = useEditor.getState();
    update((p) => void (p.music && removeMusicPiece(p.music, index)));
    setSel(null);
    setNotice("Removed that piece of the music and closed the gap. Undo brings it back.");
  };

  return (
    <div ref={root} className="absolute top-1 h-5" style={{ width: shownPx }} data-music-block onPointerLeave={() => setCutX(null)}>
      {layout.map(({ start, end }, i) => {
        const left = start * pxPerSec;
        const width = Math.max(6, (end - start) * pxPerSec);
        const isSel = selected === i;
        return (
          <div
            key={i}
            className={cx(
              "group absolute inset-y-0 overflow-hidden rounded-md border text-[12px] text-white",
              isSel ? "cursor-default border-sys-blue ring-2 ring-sys-blue/40" : "cursor-pointer border-sys-green/50 bg-sys-green/15",
            )}
            style={{ left, width, backgroundImage: gradient, backgroundSize: `${shownPx}px 100%`, backgroundPosition: `${-left}px 0`, backgroundRepeat: "no-repeat", backgroundOrigin: "border-box" }}
            title={`${music.name} · ${formatTime(end - start)}${cut ? ` · piece ${i + 1} of ${layout.length}` : ""}${isSel ? " · click to cut here" : " · click to select"}`}
            data-music-piece={i}
            data-selected={isSel ? "" : undefined}
            onPointerDown={(e) => {
              e.stopPropagation();
              useEditor.getState().setTool("music");
              const r = e.currentTarget.getBoundingClientRect();
              const lx = e.clientX - r.left;
              const mode = i === 0 && lx < EDGE ? "l" : i === last && lx > r.width - EDGE ? "r" : null;
              e.currentTarget.setPointerCapture(e.pointerId);
              if (mode) {
                drag.current = { mode, startX: e.clientX, pieces: musicPieces(music).map((p) => ({ ...p })), shown };
                useEditor.getState().beginTransaction();
                return;
              }
              // The first click selects the piece, the next one cuts it.
              press.current = { index: i, wasSelected: selected === i, startX: e.clientX };
              setSel(i);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (d) {
                const dt = (e.clientX - d.startX) / pxPerSec;
                useEditor.getState().update(
                  (p) => {
                    const m = p.music;
                    if (!m) return;
                    applyMusicPieces(m, d.mode === "l" ? headTo(d.pieces, d.pieces[0].from + dt) : tailTo(d.pieces, m.duration, d.shown + dt));
                  },
                  { history: false },
                );
                return;
              }
              if (isSel && e.pointerType !== "touch" && e.buttons === 0) setCutX(e.clientX - root.current!.getBoundingClientRect().left);
              else if (cutX !== null) setCutX(null);
            }}
            onPointerUp={(e) => {
              try {
                e.currentTarget.releasePointerCapture(e.pointerId);
              } catch {
                /* not captured */
              }
              if (drag.current) {
                drag.current = null;
                useEditor.getState().endTransaction();
                return;
              }
              const p = press.current;
              press.current = null;
              if (!p || !p.wasSelected || e.pointerType === "touch" || e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || Math.abs(e.clientX - p.startX) > CLICK_SLOP) return;
              cutAt(timeAt(e.clientX));
            }}
            onPointerCancel={() => {
              press.current = null;
              if (!drag.current) return;
              drag.current = null;
              useEditor.getState().endTransaction();
            }}
          >
            <div className="relative flex h-full items-center gap-1 px-1.5">
              {i === 0 && <Music size={10} className="shrink-0" />}
              {(i === 0 || cut) && <span className="truncate">{i === 0 ? music.name : formatTime(end - start)}</span>}
              {i === 0 && !cut && <span className="shrink-0 tabular-nums text-white/60">{formatTime(songLen)}</span>}
            </div>
            {cut && width >= 44 && (
              <button
                type="button"
                className={cx(
                  "absolute right-0.5 top-0.5 z-10 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-white/85 hover:bg-sys-red hover:text-white",
                  isSel ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                )}
                title="Remove this piece of the music"
                aria-label={`Remove music piece ${i + 1}`}
                data-music-remove={i}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removePiece(i);
                }}
              >
                <Trash2 size={10} />
              </button>
            )}
            {i === 0 && <div className="absolute inset-y-0 left-0 z-[5] w-[7px] cursor-col-resize touch-none bg-white/40 hover:bg-white/70" data-music-handle="l" />}
            {i === last && <div className="absolute inset-y-0 right-0 z-[5] w-[7px] cursor-col-resize touch-none bg-white/40 hover:bg-white/70" data-music-handle="r" />}
          </div>
        );
      })}
      {shown > used + 0.05 && (
        <div
          className="pointer-events-none absolute inset-y-0 right-0 flex items-center justify-end overflow-hidden pr-2"
          style={{ left: used * pxPerSec, backgroundImage: "repeating-linear-gradient(135deg, rgba(0,0,0,0.5) 0 5px, rgba(0,0,0,0.25) 5px 10px)" }}
          data-music-unused
        >
          {(shown - used) * pxPerSec > 260 && (
            <span className="rf-read-face truncate rounded bg-black/60 px-1.5 text-[12px] text-white/80">{duration > 0 ? "Past the end of the video · not in the export" : "Plays under your video once you add one"}</span>
          )}
        </div>
      )}
      {selected !== null && cutX !== null && cutX > layout[selected].start * pxPerSec && cutX < layout[selected].end * pxPerSec && (
        <div className="pointer-events-none absolute -inset-y-0.5 z-20 w-px bg-white shadow-[0_0_4px_rgba(255,255,255,0.8)]" style={{ left: cutX }} data-music-cut-indicator />
      )}
    </div>
  );
}
