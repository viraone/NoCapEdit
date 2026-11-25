"use client";

import type { ReactNode } from "react";
import { X } from "lucide-react";

// The look shared by the Instagram windows (Story, Post / Reel).

export const dialogClass = "card fixed left-6 top-20 z-50 flex max-h-[calc(100vh-7rem)] w-[30rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/60";

export const goButtonClass =
  "flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange text-[14px] font-bold text-white shadow-lg shadow-sys-pink/25 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

/** A rounded group with a small coloured icon beside its first caption. */
export function Card({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

/** One choice in a pill-shaped row; the chosen one is filled white. */
export const segment = (on: boolean) => `rounded-full px-2.5 py-1 text-[12px] font-semibold normal-case transition-colors ${on ? "bg-white text-black shadow" : "text-white/60 enabled:hover:text-white"}`;
export const segmentRow = "inline-flex items-center gap-0.5 rounded-full bg-black/40 p-0.5 ring-1 ring-inset ring-white/10";

export function SwitchRow({ checked, onChange, label, hint, data }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; data: Record<string, string> }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-white">{label}</span>
        <span className="rf-read-face mt-0.5 block text-[12px] leading-snug text-white/55">{hint}</span>
      </span>
      <span className="relative h-6 w-11 shrink-0">
        <input type="checkbox" className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0" checked={checked} onChange={(e) => onChange(e.target.checked)} {...data} />
        <span className={`absolute inset-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-sys-pink/70 ${checked ? "bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange" : "bg-white/15"}`} />
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </span>
    </label>
  );
}

export function DialogHeader({ icon, title, onClose, closeData }: { icon: ReactNode; title: string; onClose: () => void; closeData: Record<string, string> }) {
  return (
    <>
      <div className="h-1 shrink-0 bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange" />
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-sys-purple via-sys-pink to-sys-orange text-white shadow-lg shadow-sys-pink/25">
          {icon}
        </span>
        <h3 className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold tracking-wide text-white">{title}</span>
          <span className="rf-read-face block text-[12px] font-normal text-white/55">Set it up, then press Go.</span>
        </h3>
        <button type="button" onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/60 transition-colors hover:bg-white/15 hover:text-white" aria-label="Close" {...closeData}>
          <X size={16} />
        </button>
      </div>
    </>
  );
}
