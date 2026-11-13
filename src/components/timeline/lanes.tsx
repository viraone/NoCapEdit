"use client";
import { useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { useEditor, type Selection } from "@/store/editorStore";
import type { CaptionCue, MusicTrack, Voiceover } from "@/lib/models/project";
import type { ClipLayout } from "@/lib/models/timeline";
import { toSourceTime } from "@/lib/models/timeline";
import { formatTime } from "@/lib/utils/time";
import { clamp } from "@/lib/utils/math";
import { cx } from "@/lib/utils/cx";
import { loadThumbs, type Loaded } from "./Filmstrip";
import { AudioWaveform } from "./AudioWaveform";
import { MusicLane } from "./MusicLane";
import { CUE_H, RULER_H, visibleWindow } from "./dockLayout";
import { EDGE, CLICK_SLOP } from "./laneConstants";
import { StretchGhost, stretchGeometry } from "./ClipBlock";

/** Below this width (px) a caption chip has no room for words: it is drawn as a plain bar. */
const CUE_LABEL_MIN_W = 30;

function rulerLabel(t: number, fine: boolean): string {
  if (fine) return formatTime(t, true);
  if (t < 60) return `${Math.round(t)}s`;
  return formatTime(t, false);
}

export function Ruler({ pxPerSec, duration, width }: { pxPerSec: number; duration: number; width: number }) {
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

export function Playhead({ pxPerSec, scrollRef, height }: { pxPerSec: number; scrollRef: React.RefObject<HTMLDivElement | null>; height: number }) {
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
      <span className="absolute inset-y-0 left-0 w-2.5 cursor-ew-resize" />
      <span className="absolute inset-y-0 right-0 w-2.5 cursor-ew-resize" />
    </div>
  );
}

export function CueLane({
  cues,
  pxPerSec,
  width,
  selection,
  activeCueId,
  showTranslated,
  onOpenSubtitles,
}: {
  cues: CaptionCue[];
  pxPerSec: number;
  /** Content width of the timeline (px), for the empty-state prompt. */
  width: number;
  selection: Selection | null;
  activeCueId: string | null;
  showTranslated: boolean;
  onOpenSubtitles: () => void;
}) {
  return (
    <div className="relative border-b border-sys-gray5/70" style={{ height: CUE_H }}>
      {cues.length === 0 && (
        <button
          type="button"
          className="absolute inset-x-1 top-1 flex h-[26px] items-center justify-center gap-2 rounded-md border border-sys-gray4 bg-sys-gray5 rf-read-face text-[14px] text-white/80 hover:bg-sys-gray4 hover:text-white"
          style={{ width: Math.max(0, width - 8) }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onOpenSubtitles}
        >
          <MessageSquare size={14} />
          <span>
            <b className="font-semibold text-white">No subtitles yet.</b> Click here, then press Generate captions.
          </span>
        </button>
      )}
      {cues.map((cue) => (
        <CueBlock
          key={cue.id}
          cue={cue}
          pxPerSec={pxPerSec}
          selected={selection?.kind === "cue" && selection.id === cue.id}
          active={activeCueId === cue.id}
          showTranslated={showTranslated}
        />
      ))}
    </div>
  );
}

/** Floating frame preview while hovering the video lane. */
export function HoverPreview({ x, time, layout }: { x: number; time: number; layout: ClipLayout }) {
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

/** Clip audio on its own lane: one waveform block per clip, aligned with its video block. */
export function AudioLane({
  layouts,
  pxPerSec,
  height,
  selection,
  view,
  cutSideOf,
  onSelect,
  onCut,
}: {
  layouts: ClipLayout[];
  pxPerSec: number;
  /** Height of the audio lane (px). */
  height: number;
  selection: Selection | null;
  view: { from: number; to: number };
  /** Which way a cut half pulls apart, matching its video block. */
  cutSideOf: (id: string) => string | undefined;
  onSelect: (id: string) => void;
  /** A click (no drag) on a block at project time t: cut the clip there. */
  onCut: (t: number) => void;
}) {
  /** clientX where a press on an audio block began, so a click (not a drag) cuts. */
  const audioPress = useRef<number | null>(null);
  /** Whether the audio block pressed was already selected: the first click selects, the next one cuts. */
  const audioWasSelected = useRef(false);
  return (
    <div className="relative border-b border-sys-gray5/70" style={{ height }} data-audio-lane>
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
            style={{ left: layout.start * pxPerSec, width: w, height: height - 8 }}
            title={`${layout.clip.name} audio${layout.clip.audioAssetId ? ` (${layout.clip.audioLabel ?? "cleaned"})` : ""}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              audioWasSelected.current = selection?.kind === "clip" && selection.id === layout.clip.id;
              onSelect(layout.clip.id);
              audioPress.current = e.clientX;
            }}
            onPointerUp={(e) => {
              const from = audioPress.current;
              audioPress.current = null;
              if (from === null || !audioWasSelected.current || e.pointerType === "touch" || e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || Math.abs(e.clientX - from) > CLICK_SLOP) return;
              const lane = e.currentTarget.parentElement!;
              onCut((e.clientX - lane.getBoundingClientRect().left) / pxPerSec);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              useEditor.getState().setTool("trim");
            }}
          >
            <div className="absolute inset-y-0" style={{ left: geo.left, width: geo.mediaW }}>
              <AudioWaveform assetId={layout.clip.audioAssetId ?? layout.clip.assetId} inPoint={geo.inPoint} outPoint={geo.outPoint} width={geo.mediaW} height={height - 8} color="rgba(255,214,10,0.9)" visible={strip} />
            </div>
            {geo.left > 0 && <StretchGhost side="l" width={geo.left} seconds={geo.before} />}
            {geo.right > 0 && <StretchGhost side="r" width={geo.right} seconds={geo.after} />}
          </div>
        );
      })}
    </div>
  );
}

/** The music row: voice-over and sound-effect blocks, with the song drawn under them. */
export function MusicRow({
  voiceovers,
  music,
  pxPerSec,
  height,
  shown,
  used,
  duration,
  view,
  selection,
  onPick,
}: {
  voiceovers: Voiceover[];
  music: MusicTrack | null;
  pxPerSec: number;
  /** Height of the music lane (px); the song block sits 10 px inside it. */
  height: number;
  shown: number;
  used: number;
  duration: number;
  view: { from: number; to: number };
  selection: Selection | null;
  onPick: (vo: Voiceover) => void;
}) {
  return (
    <div className="relative" style={{ height }}>
      {voiceovers.map((vo) => (
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
            onPick(vo);
          }}
        >
          <span className="truncate">{vo.kind === "sfx" ? "🔔" : "🎙"} {vo.name}</span>
        </div>
      ))}
      {music && <MusicLane music={music} pxPerSec={pxPerSec} shown={shown} used={used} duration={duration} height={height - 10} view={view} />}
    </div>
  );
}
