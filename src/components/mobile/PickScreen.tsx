"use client";
import { useRef, useSyncExternalStore } from "react";
import { AlertTriangle, ChevronUp, Share2, Sparkles, Upload, Wand2 } from "lucide-react";
import type { LiteSupport } from "@/lib/mobile/exportLite";
import { PrimaryButton, Segmented } from "./MobileChrome";
import { noopSubscribe, readHomeScreenTip } from "./mobileHelpers";

export function PickScreen({
  support,
  accurate,
  onAccurate,
  onPick,
}: {
  support: LiteSupport | null;
  accurate: boolean;
  onAccurate: (v: boolean) => void;
  onPick: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const unsupported = support && !support.ok;
  const homeScreenTip = useSyncExternalStore(noopSubscribe, readHomeScreenTip, () => false);
  return (
    <div className="flex flex-1 flex-col">
      <div className="relative overflow-hidden rounded-[28px] bg-[#101012] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_24px_60px_rgba(0,0,0,0.55)]">
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-24 h-64 w-64 rounded-full bg-brand-500/30 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -right-20 top-10 h-56 w-56 rounded-full bg-sys-indigo/25 blur-3xl" />
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-label-2">
            <Sparkles size={12} className="text-sys-yellow" /> Whisper on your phone · nothing uploaded
          </span>
          <h1 className="mt-4 text-[32px] font-bold leading-[1.05] tracking-tight">
            Captions,
            <br />
            in a tap.
          </h1>
          <p className="mt-3 text-[15px] leading-snug text-label-2">Pick a clip, choose a look, save it back to Photos. About a minute for a five-minute video.</p>
          <input
            ref={inputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) onPick(f);
            }}
          />
          <PrimaryButton className="mt-6" onClick={() => inputRef.current?.click()} disabled={!!unsupported}>
            <Upload size={18} /> Choose a video
          </PrimaryButton>
          <p className="mt-2.5 text-center text-[11px] leading-snug text-label-3">
            <span className="text-label-2">Photo Library</span> for your camera roll · <span className="text-label-2">Choose File</span> for a clip in Files
          </p>
          {unsupported && (
            <p className="mt-3 flex items-start gap-2 text-[13px] text-sys-orange">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {support?.reason}
            </p>
          )}
        </div>
      </div>

      {/* Three steps */}
      <ol className="mt-4 grid grid-cols-3 gap-2">
        {[
          { n: 1, icon: Upload, label: "Pick a clip" },
          { n: 2, icon: Wand2, label: "Choose a look" },
          { n: 3, icon: Share2, label: "Save to Photos" },
        ].map(({ n, icon: Icon, label }) => (
          <li key={n} className="rounded-2xl bg-white/[0.04] p-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.08] text-label-2">
              <Icon size={15} />
            </span>
            <p className="mt-2 text-[12px] font-medium leading-tight">
              <span className="text-label-3">{n}. </span>
              {label}
            </p>
          </li>
        ))}
      </ol>

      <div className="mt-4 flex items-center justify-between rounded-2xl bg-white/[0.04] p-3 pl-4">
        <div className="min-w-0">
          <p className="text-[14px] font-semibold">Speech model</p>
          <p className="text-[11px] text-label-2">{accurate ? "Best for crowds, rooms, noise · 80 MB once" : "Quiet, clear speech · 45 MB once"}</p>
        </div>
        <Segmented
          size="sm"
          value={accurate ? "accurate" : "fast"}
          options={[
            { value: "accurate", label: "Accurate" },
            { value: "fast", label: "Fast" },
          ]}
          onChange={(v) => onAccurate(v === "accurate")}
        />
      </div>

      {homeScreenTip && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-[11px] text-label-3">
          <ChevronUp size={12} /> Share → <span className="text-label-2">Add to Home Screen</span> to use it like an app
        </p>
      )}

      <p className="mt-auto pt-6 text-center text-[11px] text-label-3">
        For timelines, transitions and more, use the desktop editor.
        <span className="mt-1 block font-mono text-[10px] text-label-3/70">build {process.env.NEXT_PUBLIC_BUILD_SHA ?? "dev"}</span>
      </p>
    </div>
  );
}
