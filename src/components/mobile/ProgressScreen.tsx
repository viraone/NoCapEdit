"use client";
import { Loader2, Sparkles, X } from "lucide-react";
import { cx } from "@/lib/utils/cx";
import { ActionBar, SecondaryButton } from "./MobileChrome";

export function StatusLine({ status }: { status: { message: string; progress: number | null; detail?: string } }) {
  const pct = status.progress === null ? null : Math.round(status.progress * 100);
  return (
    <div>
      <div className="flex items-center justify-between text-[15px]">
        <span className="flex items-center gap-2 font-medium">
          <Loader2 size={15} className="animate-spin text-brand-400" /> {status.message}
        </span>
      </div>
      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className={cx("h-full rounded-full bg-gradient-to-r from-brand-500 to-sys-indigo transition-[width]", pct === null && "w-1/3 animate-pulse")}
          style={pct === null ? undefined : { width: `${pct}%` }}
        />
      </div>
      {status.detail && <p className="mt-1.5 truncate text-[12px] text-label-2">{status.detail}</p>}
    </div>
  );
}

export function ProgressScreen({
  title,
  status,
  note,
  onCancel,
}: {
  title: string;
  status: { message: string; progress: number | null; detail?: string };
  note: string;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative overflow-hidden rounded-[28px] bg-[#101012] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.55)]">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-brand-500/25 blur-3xl" />
        <div className="relative">
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.06] text-sys-yellow">
            <span className="absolute inset-0 animate-ping rounded-2xl bg-sys-yellow/10" />
            <Sparkles size={26} />
          </span>
          <p className="mt-4 text-[22px] font-bold tracking-tight">{title}</p>
          <div className="mt-4">
            <StatusLine status={status} />
          </div>
        </div>
      </div>
      <p className="mt-3 px-2 text-center text-[12px] leading-snug text-label-2">{note}</p>
      <div className="flex-1" />
      <ActionBar>
        <SecondaryButton className="w-full" onClick={onCancel}>
          <X size={15} /> Cancel
        </SecondaryButton>
      </ActionBar>
    </div>
  );
}
