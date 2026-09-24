import type { ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

export function Field({ label, hint, right, children, className }: { label: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="caps">{label}</span>
        {right && <span className="text-[11px] tabular-nums text-label-2">{right}</span>}
      </div>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-label-3">{hint}</p>}
    </label>
  );
}

export const inputClass =
  "w-full h-8 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 text-[13px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 disabled:opacity-50";

export const textareaClass =
  "w-full min-h-16 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-1.5 text-[13px] leading-snug text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 resize-y";
