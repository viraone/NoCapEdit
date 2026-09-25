"use client";
import { useRef, useState } from "react";
import { cx } from "@/lib/utils/cx";
import { inputClass, useFieldControl } from "./Field";
import { parseNumberDraft } from "@/lib/utils/math";

/** Numeric input that commits on blur/Enter so typing never fights with state updates. */
export function NumberInput({ value, onCommit, min, max, step = 0.01, decimals = 2, className, suffix, disabled }: { value: number; onCommit: (v: number) => void; min?: number; max?: number; step?: number; decimals?: number; className?: string; suffix?: string; disabled?: boolean }) {
  const field = useFieldControl();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value.toFixed(decimals));
  const [prevValue, setPrevValue] = useState(value);
  /** Set once the user actually types; a focus/blur or Enter with nothing typed commits nothing. */
  const [dirty, setDirty] = useState(false);
  if (prevValue !== value) {
    // Derived state: the prop changed, resync the draft text during render.
    setPrevValue(value);
    setText(value.toFixed(decimals));
    setDirty(false);
  }
  const commit = () => {
    if (!dirty) {
      setText(value.toFixed(decimals));
      return;
    }
    setDirty(false);
    const n = parseNumberDraft(text, inputRef.current?.validity.badInput ?? false);
    if (n === null) {
      // Cleared, or nothing the browser could parse: revert rather than committing 0.
      setText(value.toFixed(decimals));
      return;
    }
    let v = n;
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    setText(v.toFixed(decimals));
    if (v === value) return; // unchanged after clamping: no edit, no undo step
    onCommit(v);
  };
  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={field?.id}
        aria-labelledby={field?.captionId}
        aria-describedby={field?.hintId}
        type="number"
        inputMode="decimal"
        className={cx(inputClass, "tabular-nums", suffix && "pr-7", className)}
        value={text}
        step={step}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => {
          setDirty(true);
          setText(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-label-3">{suffix}</span>}
    </div>
  );
}
