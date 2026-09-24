"use client";
import { useEffect, useRef } from "react";
import { getPreviewCanvas } from "@/components/CanvasRenderer";

/** Histogram and vectorscope sampled from the preview canvas a few times per second. */
export function Scopes() {
  const histRef = useRef<HTMLCanvasElement>(null);
  const vecRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 54;
    const sctx = sample.getContext("2d", { willReadFrequently: true })!;
    let timer = 0;
    const tick = () => {
      const src = getPreviewCanvas();
      const hist = histRef.current;
      const vec = vecRef.current;
      if (src && hist && vec && src.width > 0) {
        sctx.drawImage(src, 0, 0, sample.width, sample.height);
        const { data } = sctx.getImageData(0, 0, sample.width, sample.height);
        const bins = [new Uint32Array(64), new Uint32Array(64), new Uint32Array(64)];
        const vctx = vec.getContext("2d")!;
        const W = vec.width;
        const H = vec.height;
        vctx.fillStyle = "#101012";
        vctx.fillRect(0, 0, W, H);
        vctx.strokeStyle = "#3a3a3c";
        vctx.beginPath();
        vctx.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2);
        vctx.moveTo(W / 2, 0);
        vctx.lineTo(W / 2, H);
        vctx.moveTo(0, H / 2);
        vctx.lineTo(W, H / 2);
        vctx.stroke();
        vctx.fillStyle = "rgba(100,210,255,0.55)";
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          bins[0][r >> 2]++;
          bins[1][g >> 2]++;
          bins[2][b >> 2]++;
          const cb = -0.1687 * r - 0.3313 * g + 0.5 * b;
          const cr = 0.5 * r - 0.4187 * g - 0.0813 * b;
          vctx.fillRect(W / 2 + (cb / 128) * (W / 2 - 2), H / 2 - (cr / 128) * (H / 2 - 2), 1.5, 1.5);
        }
        const hctx = hist.getContext("2d")!;
        const hw = hist.width;
        const hh = hist.height;
        hctx.fillStyle = "#101012";
        hctx.fillRect(0, 0, hw, hh);
        const max = Math.max(1, ...bins.map((b) => Math.max(...b)));
        const colors = ["rgba(255,69,58,0.7)", "rgba(48,209,88,0.7)", "rgba(10,132,255,0.7)"];
        hctx.globalCompositeOperation = "lighter";
        bins.forEach((b, c) => {
          hctx.fillStyle = colors[c];
          for (let i = 0; i < 64; i++) {
            const h = (b[i] / max) * (hh - 2);
            hctx.fillRect((i / 64) * hw, hh - h, hw / 64, h);
          }
        });
        hctx.globalCompositeOperation = "source-over";
      }
      timer = window.setTimeout(tick, 120);
    };
    tick();
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="grid grid-cols-[1fr_auto] gap-2">
      <div>
        <p className="caps mb-1">Histogram</p>
        <canvas ref={histRef} width={200} height={70} className="w-full rounded-md border border-sys-gray4" />
      </div>
      <div>
        <p className="caps mb-1">Vectorscope</p>
        <canvas ref={vecRef} width={70} height={70} className="rounded-md border border-sys-gray4" />
      </div>
    </div>
  );
}
