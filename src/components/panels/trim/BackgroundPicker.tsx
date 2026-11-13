"use client";
import { cx } from "@/lib/utils/cx";
import { BACKGROUNDS } from "./constants";

/** The background colour swatches under the Trim tool's picture. */
export function BackgroundPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {BACKGROUNDS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`Background ${color}`}
          onClick={() => onChange(color)}
          className={cx("h-6 w-6 rounded-full border-2 transition-transform hover:scale-110", value.toLowerCase() === color ? "border-sys-blue" : "border-white/20")}
          style={{ background: color }}
        />
      ))}
    </div>
  );
}
