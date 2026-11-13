"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Crop, Minus, Pause, Play, Plus, RotateCcw, Sparkles, Type, Wand2 } from "lucide-react";
import { cx } from "@/lib/utils/cx";
import { CAPTION_PRESETS, getPreset } from "@/lib/captions/presets";
import { drawCue } from "@/lib/captions/renderer";
import { fontFamily } from "@/lib/captions/fonts";
import type { CaptionCue, SubtitleStyle } from "@/lib/models/project";
import { aspectOf, cropRect, DEFAULT_REFRAME, FRAME_FORMATS, MAX_ZOOM, outputFrame, panBy, withZoom, type Reframe } from "@/lib/mobile/reframe";
import { ActionBar, PrimaryButton, SecondaryButton, Segmented, Toggle } from "./MobileChrome";
import { fmtTime, PREVIEW_MAX_EDGE } from "./mobileHelpers";

type Tab = "frame" | "looks" | "style" | "text";

const POSITION_PRESETS: { label: string; y: number }[] = [
  { label: "Top", y: 0.16 },
  { label: "Middle", y: 0.5 },
  { label: "Bottom", y: 0.8 },
];

export function StyleScreen({
  fileUrl,
  cues,
  setCues,
  style,
  setStyle,
  wordsPerCue,
  setWordsPerCue,
  reframe,
  setReframe,
  sourceSize,
  onExport,
}: {
  fileUrl: string;
  cues: CaptionCue[];
  setCues: (c: CaptionCue[]) => void;
  style: SubtitleStyle;
  setStyle: (s: SubtitleStyle) => void;
  wordsPerCue: number;
  setWordsPerCue: (n: number) => void;
  reframe: Reframe;
  setReframe: (r: Reframe) => void;
  sourceSize: { w: number; h: number } | null;
  onExport: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  /** Source pixel size, known once metadata loads. */
  const [videoDims, setDims] = useState<{ w: number; h: number } | null>(null);
  // The file's own size wins; what Safari reports is only the fallback.
  const dims = sourceSize ?? videoDims;
  const dimsRef = useRef(dims);
  const [tab, setTab] = useState<Tab>("looks");
  const [dragging, setDragging] = useState(false);
  // Which way the window can't move at this zoom (a 9:16 window on a
  // landscape clip already spans its full height); shown when a drag
  // pushes that way, and kept up a moment after the finger lifts.
  const [lockHintState, setLockHint] = useState<{ which: "x" | "y" | "both"; zoom: number; format: Reframe["format"] } | null>(null);
  const lockHintTimer = useRef<number | null>(null);
  const cuesRef = useRef(cues);
  const styleRef = useRef(style);
  const reframeRef = useRef(reframe);
  useEffect(() => {
    cuesRef.current = cues;
    styleRef.current = style;
    reframeRef.current = reframe;
    dimsRef.current = dims;
  });

  /** Draws the captions for the video's current time onto the overlay,
   * which covers the *output frame* (the crop), not the whole source. */
  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const size = dimsRef.current;
    if (!video || !canvas || !size) return;
    const out = outputFrame(size.w, size.h, reframeRef.current, PREVIEW_MAX_EDGE);
    if (canvas.width !== out.width || canvas.height !== out.height) {
      canvas.width = out.width;
      canvas.height = out.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, out.width, out.height);
    const t = video.currentTime;
    for (const cue of cuesRef.current) {
      if (t >= cue.start && t < cue.end) drawCue(ctx, cue, styleRef.current, out, t, { showTranslated: false });
    }
  }, []);

  // Redraw while playing from a requestAnimationFrame loop rather than
  // requestVideoFrameCallback: iOS Safari stops delivering frame callbacks
  // after a video is seeked while paused (which the #t=0.1 first-frame
  // fix does), and rAF is immune to that.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let raf = 0;
    let stopped = false;
    let lastDrawn = -1;
    const loop = () => {
      if (stopped) return;
      if (!video.paused && !video.ended && video.currentTime !== lastDrawn) {
        lastDrawn = video.currentTime;
        draw();
        setTime(video.currentTime);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    // iOS Safari can report 0×0 at loadedmetadata (seen when this screen
    // comes back after Adjust); the real size arrives with `resize` /
    // `loadeddata`. A 0×0 size would make every crop "the whole video".
    const syncDims = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) setDims({ w: video.videoWidth, h: video.videoHeight });
    };
    const onMeta = () => {
      setDuration(video.duration);
      syncDims();
      // iOS Safari shows a black box for a paused video until it has
      // seeked at least once; a tiny seek paints the first frame.
      if (video.currentTime === 0) video.currentTime = 0.01;
      draw();
    };
    const onSeeked = () => {
      draw();
      setTime(video.currentTime);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("loadedmetadata", onMeta);
    video.addEventListener("loadeddata", syncDims);
    video.addEventListener("resize", syncDims);
    video.addEventListener("seeked", onSeeked);
    // Metadata may already be in by the time this effect runs (blob URLs
    // load instantly) — the event would be missed, so apply it now too.
    if (video.readyState >= 1) onMeta();
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("timeupdate", onSeeked);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      video.removeEventListener("loadedmetadata", onMeta);
      video.removeEventListener("loadeddata", syncDims);
      video.removeEventListener("resize", syncDims);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("timeupdate", onSeeked);
    };
  }, [draw]);

  // Style, cue or frame edits while paused should show immediately.
  useEffect(() => {
    draw();
  }, [cues, style, reframe, dims, draw]);

  const preset = getPreset(style.presetId);
  const activeIndex = useMemo(() => cues.findIndex((c) => time >= c.start && time < c.end), [cues, time]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };

  const seekTo = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
  };

  // The frame box has the output shape; the <video> is sized and offset
  // inside it so exactly the crop rectangle shows (same maths as export).
  const aspect = dims ? aspectOf(reframe.format, dims.w, dims.h) : 16 / 9;
  const crop = dims ? cropRect(dims.w, dims.h, reframe) : null;
  const videoStyle: React.CSSProperties | undefined =
    dims && crop
      ? {
          width: `${(dims.w / crop.w) * 100}%`,
          height: `${(dims.h / crop.h) * 100}%`,
          left: `${(-crop.x / crop.w) * 100}%`,
          top: `${(-crop.y / crop.h) * 100}%`,
        }
      : { width: "100%", height: "100%", left: 0, top: 0 };

  const lockedX = !!(dims && crop) && dims.w - crop.w < 1;
  const lockedY = !!(dims && crop) && dims.h - crop.h < 1;

  // Gestures on the frame. Tap = play/pause. On the Frame tab a drag pans
  // the video and a two-finger pinch zooms it; on every other tab a drag
  // moves the caption.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; startX: number; startY: number; pinchDist: number; pinchZoom: number } | null>(null);
  const framing = tab === "frame";

  const onPointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (pointers.current.size === 1) {
      gesture.current = { moved: false, startX: e.clientX, startY: e.clientY, pinchDist: 0, pinchZoom: reframeRef.current.zoom };
    } else if (pointers.current.size === 2 && gesture.current) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      gesture.current.pinchZoom = reframeRef.current.zoom;
      gesture.current.moved = true;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const prev = pointers.current.get(e.pointerId);
    if (!g || !prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const el = frameRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();

    if (pointers.current.size >= 2) {
      if (!framing || !g.pinchDist) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      setDragging(true);
      setReframe(withZoom(reframeRef.current, g.pinchZoom * (dist / g.pinchDist)));
      return;
    }

    if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < 8) return;
    g.moved = true;
    setDragging(true);

    if (framing) {
      if (!dims) return;
      const c = cropRect(dims.w, dims.h, reframeRef.current);
      const perPx = c.w / rect.width; // source pixels per screen pixel
      setReframe(panBy(dims.w, dims.h, reframeRef.current, (e.clientX - prev.x) * perPx, (e.clientY - prev.y) * perPx));
      // Pushing where there is no room to go: say why nothing moves.
      const noX = dims.w - c.w < 1;
      const noY = dims.h - c.h < 1;
      const dx = Math.abs(e.clientX - g.startX);
      const dy = Math.abs(e.clientY - g.startY);
      const hint = noX && noY ? "both" : noY && dy > dx ? "y" : noX && dx > dy ? "x" : null;
      if (hint) {
        if (lockHintTimer.current) window.clearTimeout(lockHintTimer.current);
        lockHintTimer.current = null;
        setLockHint({ which: hint, zoom: reframeRef.current.zoom, format: reframeRef.current.format });
      }
    } else {
      const fx = (e.clientX - rect.left) / rect.width;
      const fy = (e.clientY - rect.top) / rect.height;
      const x = Math.abs(fx - 0.5) < 0.06 ? 0.5 : Math.min(0.85, Math.max(0.15, fx));
      const y = Math.min(0.95, Math.max(0.08, fy));
      setStyle({ ...styleRef.current, x, y });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (g && !g.moved) togglePlay();
    if (lockHintState && !lockHintTimer.current) {
      lockHintTimer.current = window.setTimeout(() => {
        lockHintTimer.current = null;
        setLockHint(null);
      }, 3000);
    }
  };
  // The hint belongs to the zoom and shape it was raised at; a pinch or a new shape retires it.
  const lockHint = lockHintState && lockHintState.zoom === reframe.zoom && lockHintState.format === reframe.format ? lockHintState.which : null;
  const LOCK_COPY = {
    y: { title: "Can't move up or down yet", body: "The full height is already in the frame. Pinch to zoom in first." },
    x: { title: "Can't move sideways yet", body: "The full width is already in the frame. Pinch to zoom in first." },
    both: { title: "The whole video is in the frame", body: "Pinch to zoom in, then drag to reposition." },
  } as const;

  const formatLabel = FRAME_FORMATS.find((f) => f.id === reframe.format)?.label ?? "Original";
  const summary = `${formatLabel} · ${preset.name} · ${cues.length} captions`;

  return (
    <div className="flex flex-1 flex-col">
      {/* Preview: a box in the output shape, the video cropped inside it.
          On the Frame tab the rest of the video shows through, dimmed,
          around the box, so you can see what you're framing. */}
      <div className={cx("relative overflow-hidden", framing && "-mx-1 px-1 py-2")}>
      <div
        ref={frameRef}
        className={cx(
          "relative mx-auto touch-none select-none rounded-[24px] bg-black shadow-[0_20px_50px_rgba(0,0,0,0.6)]",
          framing ? "overflow-visible" : "overflow-hidden",
          dragging && !framing && "ring-2 ring-brand-400",
        )}
        // Tall frames (9:16, 4:5) get more of the screen height; wide ones are bound by the width anyway.
        style={{ aspectRatio: String(aspect), width: `min(100%, calc(${aspect < 1 ? 62 : 56}dvh * ${aspect}))` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <video ref={videoRef} src={`${fileUrl}#t=0.1`} playsInline preload="auto" className="absolute max-w-none bg-black object-fill" style={videoStyle} />
        {framing && (
          // The frame's edge, and a dark veil over everything outside it
          // (a spread shadow, clipped by the wrapper). Lighter while dragging.
          <div
            aria-hidden
            className={cx("pointer-events-none absolute inset-0 rounded-[24px] border-2 transition-[box-shadow]", dragging ? "border-brand-400" : "border-white")}
            style={{ boxShadow: `0 0 0 100vmax rgba(0,0,0,${dragging ? 0.5 : 0.78})` }}
          />
        )}
        <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full overflow-hidden rounded-[24px]" />
        {framing && (
          // Rule-of-thirds guide while reframing.
          <div aria-hidden className="pointer-events-none absolute inset-0 opacity-40">
            <div className="absolute inset-y-0 left-1/3 w-px bg-white/60" />
            <div className="absolute inset-y-0 left-2/3 w-px bg-white/60" />
            <div className="absolute inset-x-0 top-1/3 h-px bg-white/60" />
            <div className="absolute inset-x-0 top-2/3 h-px bg-white/60" />
          </div>
        )}
        {!playing && !dragging && (
          <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 backdrop-blur">
            <Play size={26} className="translate-x-0.5" />
          </span>
        )}
        {lockHint ? (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-3 top-3 rounded-2xl bg-black/80 px-3 py-2 text-center shadow-lg ring-1 ring-white/15 backdrop-blur"
          >
            <p className="text-[13px] font-semibold text-white">{LOCK_COPY[lockHint].title}</p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-white/75">{LOCK_COPY[lockHint].body}</p>
          </div>
        ) : (
          dragging && (
            <span className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-medium backdrop-blur">
              {framing ? "Drag to reposition · pinch to zoom" : "Drag to place captions"}
            </span>
          )
        )}
        <div
          className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 rounded-b-[24px] bg-gradient-to-t from-black/85 to-transparent px-3 pb-2.5 pt-10 text-[12px] tabular-nums"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button type="button" onClick={togglePlay} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/15 backdrop-blur" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-px" />}
          </button>
          <span className="w-9 text-right">{fmtTime(time)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.05}
            value={Math.min(time, duration || 0)}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="h-1 min-w-0 flex-1 accent-white"
            aria-label="Scrub"
          />
          <span className="w-9 text-label-2">{fmtTime(duration)}</span>
        </div>
      </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-label-3">
        {!framing
          ? "Tap to play · drag the caption to move it"
          : lockedX && lockedY
            ? "The whole video fits · pinch to zoom in to reposition"
            : lockedY
              ? "Drag sideways to reposition · pinch to zoom for up and down"
              : lockedX
                ? "Drag up or down to reposition · pinch to zoom for sideways"
                : "Drag to reposition · pinch to zoom"}
      </p>

      {/* Tabs */}
      <Segmented
        className="mt-3 w-full"
        value={tab}
        options={[
          { value: "frame", label: <span className="inline-flex items-center gap-1"><Crop size={14} /> Frame</span> },
          { value: "looks", label: <span className="inline-flex items-center gap-1"><Wand2 size={14} /> Looks</span> },
          { value: "style", label: <span className="inline-flex items-center gap-1"><Type size={14} /> Style</span> },
          { value: "text", label: <span className="inline-flex items-center gap-1"><Check size={14} /> Text</span> },
        ]}
        onChange={setTab}
      />

      <div className="mt-3 min-h-[13rem]">
        {tab === "frame" && (
          <div className="space-y-2.5">
            <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {FRAME_FORMATS.map((f) => {
                const active = f.id === reframe.format;
                const ratio = f.ratio ?? (dims ? dims.w / dims.h : 16 / 9);
                return (
                  <button
                    key={f.id}
                    type="button"
                    aria-label={`Frame ${f.label}`}
                    onClick={() => setReframe({ ...DEFAULT_REFRAME, format: f.id })}
                    className={cx(
                      "flex h-[58px] shrink-0 items-center gap-2.5 rounded-2xl border bg-[#141416] pl-3 pr-4 transition active:scale-[0.97]",
                      active ? "border-brand-400 shadow-[0_0_0_3px_rgba(64,156,255,0.25)]" : "border-white/[0.06]",
                    )}
                  >
                    <span className="grid h-7 w-7 shrink-0 place-items-center">
                      <span
                        className={cx("block rounded-[4px] border-2", active ? "border-brand-400" : "border-white/50")}
                        style={ratio >= 1 ? { width: 26, height: 26 / ratio } : { height: 26, width: 26 * ratio }}
                      />
                    </span>
                    <span className="flex flex-col items-start gap-1">
                      <span className="text-[13px] font-semibold leading-none">{f.label}</span>
                      <span className="whitespace-nowrap text-[10px] leading-none text-label-3">{f.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Zoom</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Zoom out" onClick={() => setReframe(withZoom(reframe, +(reframe.zoom - 0.1).toFixed(2)))} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Minus size={15} />
                </button>
                <span className="w-12 text-center text-[14px] tabular-nums">{Math.round(reframe.zoom * 100)}%</span>
                <button type="button" aria-label="Zoom in" onClick={() => setReframe(withZoom(reframe, Math.min(MAX_ZOOM, +(reframe.zoom + 0.1).toFixed(2))))} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <div>
                <p className="text-[14px] font-medium">Centre the video</p>
                <p className="text-[11px] text-label-2">Undo your drag and zoom</p>
              </div>
              <SecondaryButton className="h-9 px-4 text-[13px]" onClick={() => setReframe({ ...DEFAULT_REFRAME, format: reframe.format })}>
                <RotateCcw size={14} /> Reset
              </SecondaryButton>
            </div>
          </div>
        )}

        {tab === "looks" && (
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
            {CAPTION_PRESETS.map((p) => {
              const active = p.id === style.presetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStyle({ ...style, presetId: p.id })}
                  aria-label={p.name}
                  className={cx(
                    "relative flex h-[76px] w-[104px] shrink-0 flex-col items-center justify-center gap-1.5 rounded-2xl border bg-[#141416] transition active:scale-[0.97]",
                    active ? "border-brand-400 shadow-[0_0_0_3px_rgba(64,156,255,0.25)]" : "border-white/[0.06]",
                  )}
                >
                  {active && (
                    <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-brand-400 text-black">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                  <span
                    className="max-w-full truncate px-1.5 text-[16px] leading-none"
                    style={{
                      fontFamily: fontFamily(p.font),
                      fontWeight: p.weight,
                      fontStyle: p.italic ? "italic" : undefined,
                      color: p.color,
                      textTransform: p.uppercase ? "uppercase" : undefined,
                      background: p.box?.color,
                      borderRadius: 4,
                      padding: p.box ? "2px 5px" : undefined,
                      WebkitTextStroke: p.stroke ? `0.6px ${p.stroke.color}` : undefined,
                      textShadow: p.shadow ? `0 1px 2px ${p.shadow.color}` : p.glow ? `0 0 6px ${p.glow.color}` : undefined,
                    }}
                  >
                    {p.name}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-label-3">{p.category}</span>
                </button>
              );
            })}
          </div>
        )}

        {tab === "style" && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Position</span>
              <Segmented
                size="sm"
                value={POSITION_PRESETS.find((p) => Math.abs(p.y - style.y) < 0.06)?.label ?? "custom"}
                options={POSITION_PRESETS.map((p) => ({ value: p.label, label: p.label }))}
                onChange={(label) => {
                  const p = POSITION_PRESETS.find((x) => x.label === label);
                  if (p) setStyle({ ...style, x: 0.5, y: p.y });
                }}
              />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Size</span>
              <div className="flex items-center gap-2">
                <button type="button" aria-label="Smaller" onClick={() => setStyle({ ...style, sizeScale: Math.max(0.6, +(style.sizeScale - 0.1).toFixed(2)) })} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Minus size={15} />
                </button>
                <span className="w-12 text-center text-[14px] tabular-nums">{Math.round(style.sizeScale * 100)}%</span>
                <button type="button" aria-label="Larger" onClick={() => setStyle({ ...style, sizeScale: Math.min(1.8, +(style.sizeScale + 0.1).toFixed(2)) })} className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] active:bg-white/15">
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <span className="text-[14px] font-medium">Words per caption</span>
              <Segmented size="sm" value={wordsPerCue} options={[1, 2, 3, 4].map((n) => ({ value: n, label: String(n) }))} onChange={setWordsPerCue} />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <div>
                <p className="text-[14px] font-medium">Highlight the spoken word</p>
                <p className="text-[11px] text-label-2">Karaoke-style accent as each word is said</p>
              </div>
              <Toggle on={style.highlight} onChange={(v) => setStyle({ ...style, highlight: v })} label="Highlight the spoken word" />
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
              <div>
                <p className="text-[14px] font-medium">ALL CAPS</p>
                <p className="text-[11px] text-label-2">{style.uppercase === null ? "Following the look" : style.uppercase ? "On" : "Off"}</p>
              </div>
              <Toggle on={style.uppercase ?? !!preset.uppercase} onChange={(v) => setStyle({ ...style, uppercase: v })} label="All caps" />
            </div>
          </div>
        )}

        {tab === "text" && (
          <TranscriptPanel cues={cues} setCues={setCues} activeIndex={activeIndex} playing={playing} seekTo={seekTo} font={fontFamily(preset.font)} />
        )}
      </div>

      <ActionBar>
        <PrimaryButton onClick={onExport} className="h-12! text-[16px]!">
          <Sparkles size={16} /> Export video
        </PrimaryButton>
        <p className="mt-2 text-center text-[11px] text-label-3">{summary}</p>
      </ActionBar>
    </div>
  );
}

function TranscriptPanel({
  cues,
  setCues,
  activeIndex,
  playing,
  seekTo,
  font,
}: {
  cues: CaptionCue[];
  setCues: (c: CaptionCue[]) => void;
  activeIndex: number;
  playing: boolean;
  seekTo: (t: number) => void;
  font: string;
}) {
  const activeRef = useRef<HTMLLIElement>(null);
  // Follow playback: keep the spoken line in view.
  useEffect(() => {
    if (playing && activeRef.current) activeRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeIndex, playing]);

  return (
    <div className="overflow-hidden rounded-2xl bg-white/[0.04]">
      <p className="px-4 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-label-3">Tap a time to jump · edit any word</p>
      <ul className="max-h-[38dvh] overflow-y-auto px-2 pb-2">
        {cues.map((cue, i) => {
          const active = i === activeIndex;
          return (
            <li key={cue.id} ref={active ? activeRef : undefined} className={cx("flex items-center gap-2 rounded-xl px-2 py-2", active && "bg-brand-500/20")}>
              <button type="button" onClick={() => seekTo(cue.start + 0.01)} className={cx("w-11 shrink-0 text-left text-[12px] tabular-nums", active ? "text-brand-400" : "text-label-3")}>
                {fmtTime(cue.start)}
              </button>
              <input
                value={cue.text}
                onChange={(e) => setCues(cues.map((c) => (c.id === cue.id ? { ...c, text: e.target.value } : c)))}
                className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                style={{ fontFamily: font }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
