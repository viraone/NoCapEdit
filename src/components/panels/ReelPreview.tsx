"use client";
/**
 * Plays a reel in a lightbox without leaving the current project: the reel's
 * own project runs through a private playback engine and the shared
 * compositor, so captions, framing and stickers look exactly as they export.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EngineFrame } from "@/lib/playback/engine";
import { X, Play, Pause, FolderOpen, Share2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { CanvasRenderer } from "@/components/CanvasRenderer";
import { PlaybackEngine } from "@/lib/playback/engine";
import { getFormat } from "@/lib/models/formats";
import { projectDuration } from "@/lib/models/timeline";
import type { VideoProject } from "@/lib/models/project";
import { listProjectAssets } from "@/lib/storage/db";
import { formatTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";

export function ReelPreview({ reel, onClose }: { reel: VideoProject; onClose: () => void }) {
  const router = useRouter();
  const format = getFormat(reel.formatId);
  const duration = projectDuration(reel.clips);
  const engineRef = useRef<PlaybackEngine | null>(null);
  const toggle = () => engineRef.current?.toggle();
  const seek = (t: number) => engineRef.current?.seek(t);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const stageRef = useRef<HTMLDivElement>(null);
  const images = useRef(new Map<string, HTMLImageElement>());

  // A private engine per opened reel; its media URLs are revoked on close.
  useEffect(() => {
    let cancelled = false;
    const engine = new PlaybackEngine();
    engineRef.current = engine;
    const urlsRef: { current: string[] } = { current: [] };
    (async () => {
      const assets = await listProjectAssets(reel.id);
      if (cancelled) return;
      const map: Record<string, string> = {};
      const urls: string[] = [];
      for (const a of assets) {
        const url = URL.createObjectURL(a.blob);
        urls.push(url);
        map[a.id] = url;
        if (a.type.startsWith("image/")) {
          const img = new Image();
          img.src = url;
          images.current.set(a.id, img);
        }
      }
      urlsRef.current = urls;
      engine.onTime = (t) => setTime(t);
      engine.onPlayingChange = (p) => setPlaying(p);
      engine.setProject(reel, map);
      setReady(true);
      engine.play();
    })();
    return () => {
      cancelled = true;
      engine.dispose();
      engineRef.current = null;
      for (const u of urlsRef.current) URL.revokeObjectURL(u);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reel.id]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.code === "Space") {
        e.preventDefault();
        engineRef.current?.toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scale = size.w && size.h ? Math.min((size.w - 24) / format.width, (size.h - 24) / format.height) : 0.1;
  const frame = useMemo(() => ({ width: format.width, height: format.height }), [format.width, format.height]);
  const idle: EngineFrame = useMemo(() => ({ time: 0, primary: null, secondary: null, progress: 0, transition: "none" }), []);
  const tick = useCallback(() => engineRef.current?.tick() ?? idle, [idle]);
  const getImage = useCallback((id: string) => {
    const img = images.current.get(id);
    return img && img.complete && img.naturalWidth ? img : undefined;
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm" role="dialog" aria-label="Reel preview" data-reel-preview onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex items-center gap-3 px-5 py-3 text-white" onPointerDown={(e) => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{reel.reel?.title ?? reel.name}</p>
          <p className="text-[12px] text-label-2">
            Reel {reel.reel?.index} · {reel.reel?.score}/10 · {formatTime(duration)} · {format.name} · from {formatTime(reel.reel?.start ?? 0)} in the source
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => router.push(`/editor?id=${reel.id}&tool=reels`)} title="Open this reel in the editor">
          <FolderOpen size={13} /> Open
        </Button>
        <Button variant="primary" size="sm" onClick={() => router.push(`/editor?id=${reel.id}&tool=export`)} title="Export this reel">
          <Share2 size={13} /> Export
        </Button>
        <button type="button" className="rounded-md p-1.5 text-label-2 hover:bg-sys-gray4 hover:text-white" onClick={onClose} aria-label="Close preview">
          <X size={18} />
        </button>
      </div>
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="relative overflow-hidden rounded-2xl bg-black shadow-2xl shadow-black/60" style={{ width: format.width * scale, height: format.height * scale }} onPointerDown={(e) => e.stopPropagation()} onClick={toggle}>
          {ready && <CanvasRenderer project={reel} frame={frame} cssWidth={format.width * scale} cssHeight={format.height * scale} tick={tick} images={getImage} className="block h-full w-full" />}
          {!playing && (
            <span className="pointer-events-none absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/50 text-white">
              <Play size={28} className="ml-1" fill="currentColor" />
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 px-5 py-3 text-white" onPointerDown={(e) => e.stopPropagation()}>
        <Button variant="secondary" size="iconSm" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </Button>
        <span className="w-14 text-[12px] tabular-nums text-label-2">{formatTime(time)}</span>
        <input type="range" className="rf-range flex-1" min={0} max={duration || 1} step={0.01} value={Math.min(time, duration)} onChange={(e) => seek(Number(e.target.value))} aria-label="Seek" />
        <span className="w-14 text-right text-[12px] tabular-nums text-label-2">{formatTime(duration)}</span>
      </div>
    </div>
  );
}
