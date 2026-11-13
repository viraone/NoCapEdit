"use client";
import { useEffect, useState } from "react";
import { cx } from "@/lib/utils/cx";
import type { ExportStats } from "@/lib/mobile/exportLite";
import { fmtTime } from "./mobileHelpers";

// TEMP — export timer for on-device testing. Starts when Export is tapped,
// stays pinned on screen, logs each stage. To remove: delete this file,
// the `timing` state and its updates in MobileEditor, and <ExportTimer />.

export interface ExportTiming {
  startedAt: number;
  endedAt: number | null;
  /** Stage changes, in order, each stamped with performance.now(). */
  marks: { label: string; at: number }[];
  outcome: "running" | "done" | "stopped" | "failed";
  engine: string | null;
  clipSeconds: number;
  output?: string;
  stats?: ExportStats;
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const sec = total - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

export function ExportTimer({ timing }: { timing: ExportTiming }) {
  const [now, setNow] = useState(timing.startedAt);
  const [open, setOpen] = useState(true);
  const running = timing.endedAt === null;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(id);
  }, [running]);

  const end = timing.endedAt ?? Math.max(now, timing.startedAt);
  const elapsed = end - timing.startedAt;
  const speed = timing.outcome === "done" && elapsed > 0 && timing.clipSeconds > 0 ? timing.clipSeconds / (elapsed / 1000) : null;
  const tone =
    timing.outcome === "done" ? "border-sys-green/40 text-sys-green" : timing.outcome === "running" ? "border-brand-400/50 text-white" : "border-sys-orange/40 text-sys-orange";

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+3.75rem)] z-40 flex justify-center px-4" data-export-timer>
      <div className={cx("pointer-events-auto w-full max-w-[448px] rounded-2xl border bg-black/85 px-3 py-2 font-mono text-[12px] shadow-xl backdrop-blur", tone)}>
        <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between gap-3 text-left">
          <span className="flex items-center gap-2">
            <span className={cx("h-2 w-2 rounded-full", running ? "animate-pulse bg-brand-400" : timing.outcome === "done" ? "bg-sys-green" : "bg-sys-orange")} />
            <span className="text-[15px] font-semibold tabular-nums" data-export-elapsed>{fmtElapsed(elapsed)}</span>
            <span className="text-label-2">
              {running ? timing.marks[timing.marks.length - 1]?.label ?? "Starting" : timing.outcome === "done" ? "Export finished" : timing.outcome === "stopped" ? "Stopped" : "Failed"}
            </span>
          </span>
          <span className="shrink-0 text-label-3">{open ? "hide" : "log"}</span>
        </button>
        {open && (
          <div className="mt-1.5 space-y-0.5 border-t border-white/10 pt-1.5 text-[11px] text-label-2">
            {timing.marks.map((m, i) => {
              const next = timing.marks[i + 1]?.at ?? end;
              return (
                <div key={`${m.label}-${m.at}`} className="flex justify-between gap-3 tabular-nums">
                  <span className="truncate">{m.label}</span>
                  <span>{fmtElapsed(next - m.at)}</span>
                </div>
              );
            })}
            {!running && (
              <div className="flex justify-between gap-3 border-t border-white/10 pt-1 tabular-nums text-white">
                <span>
                  {timing.engine ? `${timing.engine} engine` : "total"} · clip {fmtTime(timing.clipSeconds)}
                </span>
                <span>{speed ? `${speed.toFixed(1)}× real time` : fmtElapsed(elapsed)}</span>
              </div>
            )}
            {!running && timing.stats && (
              <div className="space-y-0.5 border-t border-white/10 pt-1 tabular-nums" data-export-stats>
                <div className="truncate">
                  {timing.stats.source} → {timing.output}
                </div>
                <div>
                  per frame: draw {timing.stats.msVideo.toFixed(1)}
                  {timing.stats.gpu
                    ? ` (import ${timing.stats.gpu.import.toFixed(1)} · layers ${timing.stats.gpu.layers.toFixed(1)} · submit ${timing.stats.gpu.submit.toFixed(1)} · wait ${timing.stats.gpu.wait.toFixed(1)} · pack ${timing.stats.gpu.pack.toFixed(1)})`
                    : ""}{" "}
                  · captions{" "}
                  {timing.stats.msCaptions.toFixed(1)} · decode+encode {timing.stats.msOther.toFixed(1)} ms
                </div>
                <div>
                  {timing.stats.frames} frames{timing.stats.passthroughFrames ? ` (${timing.stats.passthroughFrames} untouched)` : ""} ·{" "}
                  {(timing.stats.frames / Math.max(0.001, elapsed / 1000)).toFixed(0)} fps · {timing.stats.captionRenders} caption renders
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
