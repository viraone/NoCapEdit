"use client";
import { cx } from "@/lib/utils/cx";

export interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ label, value, min, max, step = 0.01, onChange, onDragStart, onDragEnd, format, disabled, className }: SliderProps) {
  const display = format ? format(value) : value.toFixed(2);
  return (
    <div className={cx("block", className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</span>
          <span className="text-[11px] tabular-nums text-neutral-300">{display}</span>
        </div>
      )}
      <input
        type="range"
        className="rf-range w-full"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerDown={onDragStart}
        onPointerUp={onDragEnd}
        onKeyUp={onDragEnd}
        onBlur={onDragEnd}
        aria-label={label}
      />
    </div>
  );
}
