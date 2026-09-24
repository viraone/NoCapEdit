"use client";
import { cx } from "@/lib/utils/cx";

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left hover:bg-neutral-800/50 disabled:opacity-50"
    >
      <span>
        <span className="block text-sm text-neutral-200">{label}</span>
        {description && <span className="block text-[11px] text-neutral-500">{description}</span>}
      </span>
      <span className={cx("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-brand-500" : "bg-neutral-700")}>
        <span className={cx("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", checked ? "left-4.5" : "left-0.5")} />
      </span>
    </button>
  );
}
