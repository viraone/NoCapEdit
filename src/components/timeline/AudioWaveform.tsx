"use client";
import { useEffect, useRef, useState } from "react";
import { getPeaks, type PeaksRecord } from "@/lib/storage/db";
import { onAssetReady } from "@/lib/media/events";

const cache = new Map<string, Promise<PeaksRecord | undefined>>();
function loadPeaks(assetId: string, force = false) {
  if (!force && cache.has(assetId)) return cache.get(assetId)!;
  const p = getPeaks(assetId);
  cache.set(assetId, p);
  return p;
}

/** Mirrored peak bars for the clip's trimmed range, drawn on a canvas. */
export function AudioWaveform({ assetId, inPoint, outPoint, width, height, color = "rgba(52,211,153,0.85)" }: { assetId: string; inPoint: number; outPoint: number; width: number; height: number; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peaks, setPeaks] = useState<PeaksRecord | undefined>();

  useEffect(() => {
    let alive = true;
    loadPeaks(assetId).then((p) => alive && setPeaks(p));
    const off = onAssetReady("peaks", (id) => {
      if (id === assetId) loadPeaks(assetId, true).then((p) => alive && setPeaks(p));
    });
    return () => {
      alive = false;
      off();
    };
  }, [assetId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);
    if (!peaks) return;
    const range = Math.max(0.001, outPoint - inPoint);
    const mid = height / 2;
    ctx.fillStyle = color;
    const step = 1;
    for (let x = 0; x < width; x += step) {
      const t0 = inPoint + (x / width) * range;
      const t1 = inPoint + ((x + step) / width) * range;
      const i0 = Math.floor(t0 * peaks.perSecond);
      const i1 = Math.max(i0 + 1, Math.floor(t1 * peaks.perSecond));
      let v = 0;
      for (let i = i0; i < i1 && i < peaks.peaks.length; i++) v = Math.max(v, peaks.peaks[i]);
      const h = Math.max(1, (v / 255) * height);
      ctx.fillRect(x, mid - h / 2, step, h);
    }
  }, [peaks, inPoint, outPoint, width, height, color]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-x-0 bottom-0" style={{ width, height }} />;
}
