"use client";
import { useEffect, useRef, useState } from "react";
import { getPeaks, type PeaksRecord } from "@/lib/storage/db";
import { onAssetReady } from "@/lib/media/events";
import { ensurePeaks, type BackfillResult } from "@/lib/media/peaksBackfill";
import { stripScale, type StripWindow } from "./dockLayout";

const cache = new Map<string, Promise<PeaksRecord | undefined>>();
function loadPeaks(assetId: string, force = false) {
  if (!force && cache.has(assetId)) return cache.get(assetId)!;
  const p = getPeaks(assetId);
  cache.set(assetId, p);
  return p;
}

const MISSING_LABEL: Record<"drawing" | BackfillResult, string | null> = {
  drawing: "Drawing the waveform…",
  ready: null,
  "no-audio": "No waveform: this audio could not be read",
  "too-large": "No waveform: the file is over 2 GB",
  missing: "No waveform: the media file is missing",
};

/**
 * Mirrored peak bars for the clip's trimmed range, drawn on a canvas. Only
 * the `visible` part of the block gets a canvas (the whole block when it is
 * not given); the bars are placed by block pixel, so they stay put as that
 * part moves with the scroll.
 */
export function AudioWaveform({ assetId, inPoint, outPoint, width, height, color = "rgba(52,211,153,0.85)", visible }: { assetId: string; inPoint: number; outPoint: number; width: number; height: number; color?: string; visible?: StripWindow }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<PeaksRecord | undefined>();
  /** Set while peaks are missing: "drawing" until the background decode settles, then why it could not. */
  const [missing, setMissing] = useState<"drawing" | BackfillResult | null>(null);
  const x0 = visible?.x0 ?? 0;
  const x1 = Math.min(width, visible?.x1 ?? width);
  const cssW = Math.max(0, x1 - x0);

  useEffect(() => {
    let alive = true;
    loadPeaks(assetId).then((p) => {
      if (!alive) return;
      setPeaks(p);
      if (p) return setMissing(null);
      // Import skipped it (a very large file) or the asset never went through import
      // (cleaned-up audio, a cut reel): decode it now, in the background.
      setMissing("drawing");
      ensurePeaks(assetId).then((r) => alive && setMissing(r === "ready" ? null : r));
    });
    const off = onAssetReady("peaks", (id) => {
      if (id !== assetId) return;
      loadPeaks(assetId, true).then((p) => {
        if (!alive) return;
        setPeaks(p);
        if (p) setMissing(null);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [assetId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cssW <= 0 || height <= 0) return;
    const scale = stripScale(cssW, window.devicePixelRatio);
    canvas.width = Math.round(cssW * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, cssW, height);
    if (!peaks) return;
    const range = Math.max(0.001, outPoint - inPoint);
    const mid = height / 2;
    ctx.fillStyle = color;
    const step = 1;
    for (let x = x0; x < x1; x += step) {
      const t0 = inPoint + (x / width) * range;
      const t1 = inPoint + ((x + step) / width) * range;
      const i0 = Math.floor(t0 * peaks.perSecond);
      const i1 = Math.max(i0 + 1, Math.floor(t1 * peaks.perSecond));
      let v = 0;
      for (let i = i0; i < i1 && i < peaks.peaks.length; i++) v = Math.max(v, peaks.peaks[i]);
      const h = Math.max(1, (v / 255) * height);
      ctx.fillRect(x - x0, mid - h / 2, step, h);
    }
  }, [peaks, inPoint, outPoint, width, height, color, x0, x1, cssW]);

  if (cssW <= 0) return null;
  const label = missing ? MISSING_LABEL[missing] : null;
  return (
    <>
      <canvas ref={canvasRef} className="pointer-events-none absolute bottom-0" style={{ left: x0, width: cssW, height }} />
      {label && (
        <span className="pointer-events-none absolute top-1/2 -translate-y-1/2 truncate rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-label-2" style={{ left: x0 + 6, maxWidth: Math.max(0, cssW - 12) }} data-waveform-status={missing}>
          {label}
        </span>
      )}
    </>
  );
}
