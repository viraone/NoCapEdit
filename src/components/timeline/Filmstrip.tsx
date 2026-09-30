"use client";
import { useEffect, useRef, useState } from "react";
import { getAsset, getThumbs, putThumbs, type ThumbsRecord } from "@/lib/storage/db";
import { emitAssetReady, onAssetReady } from "@/lib/media/events";
import { FILMSTRIP_FRAME_HEIGHT, generateFilmstrip } from "@/lib/media/thumbnails";
import { stripScale, type StripWindow } from "./dockLayout";

export interface Loaded {
  img: HTMLImageElement;
  rec: ThumbsRecord;
}
const cache = new Map<string, Promise<Loaded | null>>();

const upgrading = new Set<string>();

/** Sprites made before the frame height was raised are rebuilt once, in the background, from the stored media. */
function upgradeIfLowRes(assetId: string, rec: ThumbsRecord) {
  if (rec.frameHeight >= FILMSTRIP_FRAME_HEIGHT || upgrading.has(assetId)) return;
  upgrading.add(assetId);
  (async () => {
    const asset = await getAsset(assetId);
    if (!asset) return;
    const next = await generateFilmstrip(assetId, asset.blob, rec.duration);
    await putThumbs(next);
    emitAssetReady("thumbs", assetId);
  })().catch(() => undefined);
}

export function loadThumbs(assetId: string, force = false): Promise<Loaded | null> {
  if (!force && cache.has(assetId)) return cache.get(assetId)!;
  const p = getThumbs(assetId).then(
    (rec) =>
      new Promise<Loaded | null>((resolve) => {
        if (!rec) return resolve(null);
        upgradeIfLowRes(assetId, rec);
        const img = new Image();
        img.onload = () => resolve({ img, rec });
        img.onerror = () => resolve(null);
        img.src = URL.createObjectURL(rec.sprite);
      }),
  );
  cache.set(assetId, p);
  return p;
}

/**
 * Draws evenly spaced thumbnails of the clip's trimmed range across the block
 * width. Only the `visible` part of the block gets a canvas (the whole block
 * when it is not given); the thumbnails sit on a grid anchored to the block's
 * left edge, so they stay put as that part moves with the scroll.
 */
export function Filmstrip({ assetId, inPoint, outPoint, width, height, visible }: { assetId: string; inPoint: number; outPoint: number; width: number; height: number; visible?: StripWindow }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [thumbs, setThumbs] = useState<Loaded | null>(null);
  const x0 = visible?.x0 ?? 0;
  const x1 = Math.min(width, visible?.x1 ?? width);
  const cssW = Math.max(0, x1 - x0);

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
    if (!canvas || cssW <= 0 || height <= 0) return;
    const scale = stripScale(cssW, window.devicePixelRatio);
    canvas.width = Math.round(cssW * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#171717";
    ctx.fillRect(0, 0, cssW, height);
    if (!thumbs) return;
    const { img, rec } = thumbs;
    const tileW = Math.max(8, rec.frameWidth * (height / rec.frameHeight));
    const range = Math.max(0.001, outPoint - inPoint);
    // From the first grid tile that reaches into the window to the last one that starts inside it.
    for (let x = Math.floor(x0 / tileW) * tileW; x < x1; x += tileW) {
      const t = inPoint + ((x + tileW / 2) / width) * range;
      const idx = Math.max(0, Math.min(rec.count - 1, Math.floor((t / Math.max(0.001, rec.duration)) * rec.count)));
      ctx.drawImage(img, idx * rec.frameWidth, 0, rec.frameWidth, rec.frameHeight, x - x0, 0, tileW, height);
    }
  }, [thumbs, inPoint, outPoint, width, height, x0, x1, cssW]);

  if (cssW <= 0) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute top-0" style={{ left: x0, width: cssW, height }} />;
}
