"use client";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ZoomIn, ZoomOut, Maximize2, Music, Captions, Film, AudioLines } from "lucide-react";
import { TransportBar } from "@/components/canvas/TransportBar";
import { useEditor } from "@/store/editorStore";
import { layoutClips, type ClipLayout } from "@/lib/models/timeline";
import { captionsClearedNotice, removeClip, splitClipAt, splitTarget } from "@/lib/models/clipOps";
import { playCutSound } from "@/lib/audio/uiSounds";
import { formatTime } from "@/lib/utils/time";
import { clamp } from "@/lib/utils/math";
import { musicLoops, musicSpan } from "@/lib/models/musicTrim";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useReelStretch } from "./useReelStretch";
import { RULER_H, CUE_H, DOCK_CHROME_H, STRIP_OVERSCAN, drawRange, videoLaneHeight } from "./dockLayout";
import { ClipBlock } from "./ClipBlock";
import { CueLane, AudioLane, MusicRow, Ruler, Playhead, HoverPreview } from "./lanes";
import { CLIP_PAD, EDGE } from "./laneConstants";
import { MomentTrack } from "./MomentTrack";
import { useMomentActive } from "./useActiveMoment";

/** Whether a click at project time `t` (x px into the lane) would cut a clip: on a clip, clear of its trim handles. */
function cuttableAt(layouts: ClipLayout[], t: number, pxPerSec: number): ClipLayout | null {
  const target = splitTarget(layouts, t);
  if (!target) return null;
  const x = t * pxPerSec;
  if (x - target.start * pxPerSec <= EDGE || target.end * pxPerSec - x <= EDGE) return null;
  return target;
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
  // The Reels panel's "+10 s before / after" buttons: the same as dragging the clip's edge out, done here, where the stretch lives.
  const stretchRequest = useEditor((s) => s.stretchRequest);
  // A Recap moment is open on the lanes: its pieces own the clips there (see MomentTrack).
  const momentActive = useMomentActive();
  const stretchHandled = useRef(0);
  useEffect(() => {
    if (!stretchRequest || stretchRequest.nonce === stretchHandled.current) return;
    stretchHandled.current = stretchRequest.nonce;
    const only = project.clips.length === 1 ? project.clips[0] : null;
    const slack = stretch.slack;
    if (!only || !slack) return;
    if (stretch.job) {
      useEditor.getState().setNotice("Wait for the current stretch to finish.");
      return;
    }
    const from = { inPoint: only.inPoint, outPoint: only.outPoint };
    const to =
      stretchRequest.side === "before"
        ? { inPoint: Math.max(-slack.before, only.inPoint - stretchRequest.seconds), outPoint: only.outPoint }
        : { inPoint: only.inPoint, outPoint: Math.min(only.duration + slack.after, only.outPoint + stretchRequest.seconds) };
    const { beginTransaction, endTransaction } = useEditor.getState();
    beginTransaction();
    const past = stretch.finishTrim({ clipId: only.id, from, to });
    endTransaction();
    if (past) void stretch.start(past);
  }, [stretchRequest, stretch, project.clips]);
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
  /** The music lane is as tall as the video lane, so its bar is the same size as a clip block. */
  const musicH = videoH;
  const lanesH = RULER_H + CUE_H + videoH + audioH + musicH;
  // Fit the video; with no video yet, fit the song.
  const fit = () => {
    const len = duration > 0 ? duration : musicShown;
    setZoom(len > 0 ? (viewW - 80) / len : 80);
  };
  // Music added to a project with no video yet, or only silent clips such as a picture (which stretches to the
  // song): zoom out so the whole song is on screen, not just its first seconds.
  const musicAssetId = music?.assetId ?? null;
  useEffect(() => {
    if (!musicAssetId) return;
    if (duration === 0) fit();
    else if (project.clips.every((c) => c.still === true || !c.hasAudio)) setZoom(musicShown > 0 ? (viewW - 80) / musicShown : 80);
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
          <Button variant="ghost" size="iconSm" onClick={() => setZoom(zoom / 1.4)} title="Zoom out (−)" aria-label="Zoom out timeline">
            <ZoomOut size={14} />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={() => setZoom(zoom * 1.4)} title="Zoom in (+)" aria-label="Zoom in timeline">
            <ZoomIn size={14} />
          </Button>
          <Button variant="ghost" size="iconSm" onClick={fit} title="Fit timeline" aria-label="Fit timeline to view">
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
          <div className="flex items-center gap-1 px-2" style={{ height: musicH }}>
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
            // The moment's pieces sit over the clip lanes: no hover preview and no cut here.
            if (momentActive) {
              if (hover) setHover(null);
              return;
            }
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
            <CueLane
              cues={project.cues}
              pxPerSec={pxPerSec}
              width={contentW}
              selection={selection}
              activeCueId={activeCueId}
              showTranslated={project.captions.showTranslated}
              onOpenSubtitles={() => setTool("subtitles")}
            />
            <div className="relative border-b border-sys-gray5/70" style={{ height: videoH }}>
              {hover && dropX === null && !momentActive && <HoverPreview x={hover.x} time={hover.time} layout={hover.layout} />}
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
            <AudioLane
              layouts={layouts}
              pxPerSec={pxPerSec}
              height={audioH}
              selection={selection}
              view={view}
              cutSideOf={cutSideOf}
              onSelect={(id) => select({ kind: "clip", id })}
              onCut={cutAt}
            />
            <MusicRow
              voiceovers={project.voiceovers}
              music={music}
              pxPerSec={pxPerSec}
              height={musicH}
              shown={musicShown}
              used={musicUsed}
              duration={duration}
              view={view}
              selection={selection}
              onPick={(vo) => {
                select({ kind: "voiceover", id: vo.id });
                seek(vo.start);
                setTool("music");
              }}
            />
            {/* Where a click would cut: a thin line through the video and audio lanes, notched at both ends. */}
            {hover?.cut && !momentActive && (
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
            <MomentTrack pxPerSec={pxPerSec} duration={duration} width={contentW} height={videoH + audioH} scrollRef={scrollRef} />
            <Playhead pxPerSec={pxPerSec} scrollRef={scrollRef} height={lanesH} />
          </div>
        </div>
      </div>
    </div>
  );
}
