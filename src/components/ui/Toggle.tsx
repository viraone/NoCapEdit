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
      className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left hover:bg-sys-gray5/60 disabled:opacity-50"
    >
      <span>
        <span className="block text-[13px] text-white">{label}</span>
        {description && <span className="block text-[11px] text-label-3">{description}</span>}
      </span>
      <span className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", checked ? "bg-sys-green" : "bg-sys-gray3")}>
        <span className={cx("absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-[2px]")} />
      </span>
    </button>
  );
}
