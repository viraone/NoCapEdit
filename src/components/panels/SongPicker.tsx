"use client";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "@/store/editorStore";
import type { MusicTrack } from "@/lib/models/project";
import { MIN_MUSIC_SECONDS, musicPieces, setMusicStart } from "@/lib/models/musicTrim";
import { AudioWaveform } from "@/components/timeline/AudioWaveform";
import { formatTime } from "@/lib/utils/time";

const HEIGHT = 56;

/**
 * The whole song as a waveform, with a window the length of the video. Click or drag to slide the
 * window to any part of the song; the music then starts there.
 */
export function SongPicker({ music, videoLen }: { music: MusicTrack; videoLen: number }) {
  const root = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(280);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(1, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const start = musicPieces(music)[0].from;
  const windowLen = Math.min(music.duration, videoLen > 0 ? videoLen : music.duration);
  const maxStart = Math.max(0, musicPieces(music)[0].to - MIN_MUSIC_SECONDS);

  const moveTo = (clientX: number, history: boolean) => {
    const box = root.current!.getBoundingClientRect();
    const t = ((clientX - box.left) / box.width) * music.duration - windowLen / 2;
    const next = Math.min(maxStart, Math.max(0, t));
    useEditor.getState().update((p) => void (p.music && setMusicStart(p.music, next)), { history });
  };

  const left = (start / music.duration) * 100;
  const windowPct = Math.min(100 - left, (windowLen / music.duration) * 100);

  return (
    <div className="space-y-1" data-song-picker>
      <div
        ref={root}
        className="relative cursor-ew-resize touch-none overflow-hidden rounded-md border border-white/15 bg-black/40"
        style={{ height: HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          useEditor.getState().beginTransaction();
          moveTo(e.clientX, false);
        }}
        onPointerMove={(e) => dragging.current && moveTo(e.clientX, false)}
        onPointerUp={(e) => {
          if (!dragging.current) return;
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
          useEditor.getState().endTransaction();
        }}
        onPointerCancel={() => {
          if (!dragging.current) return;
          dragging.current = false;
          useEditor.getState().endTransaction();
        }}
        title="Click or drag to choose which part of the song plays"
      >
        <AudioWaveform assetId={music.assetId} inPoint={0} outPoint={music.duration} width={width} height={HEIGHT} color="rgba(255,255,255,0.45)" />
        <div className="pointer-events-none absolute inset-y-0 rounded-sm border-2 border-sys-green bg-sys-green/25" style={{ left: `${left}%`, width: `${windowPct}%`, minWidth: 4 }} data-song-window />
      </div>
      <div className="flex justify-between text-[12px] tabular-nums text-white/70">
        <span>Starts at {formatTime(start)}</span>
        <span>{formatTime(music.duration)} song</span>
      </div>
    </div>
  );
}
