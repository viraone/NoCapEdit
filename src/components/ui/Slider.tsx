"use client";
import { useEffect, useRef } from "react";
import { cx } from "@/lib/utils/cx";
import { createSliderGesture, type SliderGesture } from "./sliderGesture";

export interface SliderProps {
  label?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /** Opens an undo step for the gesture; return false when it could not be opened. */
  onDragStart?: () => boolean | void;
  /** Closes the undo step; return true when one was recorded. */
  onDragEnd?: () => boolean | void;
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ label, value, min, max, step = 0.01, onChange, onDragStart, onDragEnd, format, disabled, className }: SliderProps) {
  const display = format ? format(value) : value.toFixed(2);
  // The gesture lives for the input's lifetime and always calls the latest handlers.
  const latest = useRef({ begin: onDragStart, end: onDragEnd });
  useEffect(() => {
    latest.current = { begin: onDragStart, end: onDragEnd };
  });
  const gestureRef = useRef<SliderGesture | null>(null);
  // Created on first use from an event handler, never during render.
  const g = () => (gestureRef.current ??= createSliderGesture({ begin: () => latest.current.begin?.(), end: () => latest.current.end?.() }));
  return (
    <div className={cx("block", className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between">
          <span className="caps">{label}</span>
          <span className="text-[11px] tabular-nums text-label-2">{display}</span>
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
        onPointerDown={() => g().pointerDown()}
        onPointerUp={() => g().pointerUp()}
        onPointerCancel={() => g().pointerUp()}
        onKeyDown={(e) => g().keyDown(e.key, e.metaKey || e.ctrlKey || e.altKey)}
        onKeyUp={() => g().keyUp()}
        onBlur={() => g().blur()}
        aria-label={label}
      />
    </div>
  );
}
