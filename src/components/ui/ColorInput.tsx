"use client";
import { RotateCcw } from "lucide-react";
import { cx } from "@/lib/utils/cx";

/** Converts any CSS colour the renderer accepts to #rrggbb for the native picker. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (typeof document === "undefined") return "#ffffff";
  const c = document.createElement("canvas").getContext("2d");
  if (!c) return "#ffffff";
  c.fillStyle = color;
  const v = c.fillStyle;
  return /^#[0-9a-f]{6}$/i.test(v) ? v : "#ffffff";
}

export function ColorInput({ label, value, onChange, onReset, className }: { label: string; value: string; onChange: (v: string) => void; onReset?: () => void; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-2", className)}>
      <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-neutral-500">{toHex(value)}</span>
        <label className="relative h-7 w-9 cursor-pointer overflow-hidden rounded-md border border-neutral-700" style={{ background: value }}>
          <input type="color" className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={toHex(value)} onChange={(e) => onChange(e.target.value)} aria-label={label} />
        </label>
        {onReset && (
          <button type="button" onClick={onReset} className="rounded p-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200" title="Reset">
            <RotateCcw size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
