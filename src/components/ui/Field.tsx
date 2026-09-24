import type { ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

export function Field({ label, hint, right, children, className }: { label: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">{label}</span>
        {right && <span className="text-[11px] tabular-nums text-neutral-400">{right}</span>}
      </div>
      {children}
      {hint && <p className="mt-1 text-[11px] leading-snug text-neutral-500">{hint}</p>}
    </label>
  );
}

export const inputClass =
  "w-full h-8 rounded-md border border-neutral-700/70 bg-neutral-900 px-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-brand-500/70 focus:outline-none focus:ring-1 focus:ring-brand-500/40 disabled:opacity-50";

export const textareaClass =
  "w-full min-h-16 rounded-md border border-neutral-700/70 bg-neutral-900 px-2.5 py-1.5 text-sm leading-snug text-neutral-100 placeholder:text-neutral-500 focus:border-brand-500/70 focus:outline-none focus:ring-1 focus:ring-brand-500/40 resize-y";
