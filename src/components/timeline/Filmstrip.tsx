"use client";
import { useEffect, useRef, useState } from "react";
import { getThumbs, type ThumbsRecord } from "@/lib/storage/db";
import { onAssetReady } from "@/lib/media/events";

interface Loaded {
  img: HTMLImageElement;
  rec: ThumbsRecord;
}
const cache = new Map<string, Promise<Loaded | null>>();

function loadThumbs(assetId: string, force = false): Promise<Loaded | null> {
  if (!force && cache.has(assetId)) return cache.get(assetId)!;
  const p = getThumbs(assetId).then(
    (rec) =>
      new Promise<Loaded | null>((resolve) => {
        if (!rec) return resolve(null);
        const img = new Image();
        img.onload = () => resolve({ img, rec });
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(rec.sprite);
      }),
  );
  cache.set(assetId, p);
  return p;
}

/** Draws evenly spaced thumbnails of the clip's trimmed range across the block width. */
export function Filmstrip({ assetId, inPoint, outPoint, width, height }: { assetId: string; inPoint: number; outPoint: number; width: number; height: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbs, setThumbs] = useState<Loaded | null>(null);

  useEffect(() => {
    let alive = true;
    loadThumbs(assetId).then((t) => alive && setThumbs(t));
    const off = onAssetReady("thumbs", (id) => {
      if (id === assetId) loadThumbs(assetId, true).then((t) => alive && setThumbs(t));
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
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, width, height);
    if (!thumbs) return;
    const { img, rec } = thumbs;
    const tileW = Math.max(8, rec.frameWidth * (height / rec.frameHeight));
    const range = Math.max(0.001, outPoint - inPoint);
    for (let x = 0; x < width; x += tileW) {
      const t = inPoint + ((x + tileW / 2) / width) * range;
      const idx = Math.max(0, Math.min(rec.count - 1, Math.floor((t / Math.max(0.001, rec.duration)) * rec.count)));
      ctx.drawImage(img, idx * rec.frameWidth, 0, rec.frameWidth, rec.frameHeight, x, 0, tileW, height);
    }
  }, [thumbs, inPoint, outPoint, width, height]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" style={{ width, height }} />;
}
