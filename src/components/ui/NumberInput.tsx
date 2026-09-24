"use client";
import { useState } from "react";
import { cx } from "@/lib/utils/cx";
import { inputClass } from "./Field";

/** Numeric input that commits on blur/Enter so typing never fights with state updates. */
export function NumberInput({ value, onCommit, min, max, step = 0.01, decimals = 2, className, suffix, disabled }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; decimals?: number; className?: string; suffix?: string; disabled?: boolean }) {
  const [text, setText] = useState(value.toFixed(decimals));
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    // Derived state: the prop changed, resync the draft text during render.
    setPrevValue(value);
    setText(value.toFixed(decimals));
  }
  const commit = () => {
    const n = Number(text);
    if (!Number.isFinite(n)) {
      setText(value.toFixed(decimals));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    onCommit(v);
    setText(v.toFixed(decimals));
  };
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        className={cx(inputClass, "tabular-nums", suffix && "pr-7", className)}
        value={text}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-neutral-500">{suffix}</span>}
    </div>
  );
}
