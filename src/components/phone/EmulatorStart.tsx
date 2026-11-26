"use client";

import { useEffect, useState } from "react";
import { Loader2, Power, Smartphone } from "lucide-react";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { avdLabel, startEmulator, watchEmulator } from "@/lib/phone/emulatorStart";
import { phoneBridge, type PhoneInfo } from "@/lib/phone/phoneBridge";
import { usePhone } from "@/lib/phone/phoneStore";

/**
 * Shown while the Android emulator is off (desktop app only): which virtual phone would start and a
 * Start button, then a "starting" line until it is on. The Instagram panel and the phone panel both
 * show it, and share one wait, so starting from either updates both.
 */
export function EmulatorStart({ info, onCheck, onStart }: { info: PhoneInfo; onCheck: () => void; onStart?: () => void }) {
  const emulator = usePhone((s) => s.emulator);
  const avds = info.avds ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const avd = picked && avds.includes(picked) ? picked : (info.avd ?? avds[0] ?? "");
  const starting = emulator?.state === "starting" || info.emulator === "starting";
  const failed = emulator?.state === "failed" ? emulator.text : (info.launchError ?? null);

  // It was already starting when this opened (the app was reopened mid-start): wait for it too.
  const alreadyStarting = info.emulator === "starting" && !emulator;
  const startingName = info.avd ?? "";
  useEffect(() => {
    const api = phoneBridge();
    if (alreadyStarting && api) void watchEmulator(api, startingName);
  }, [alreadyStarting, startingName]);

  if (starting) {
    const name = (emulator?.state === "starting" && emulator.avd) || info.avd || "";
    return (
      <div className="flex w-full flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left" role="status" data-emulator-starting>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sys-pink/15 text-sys-pink">
            <Loader2 size={17} className="animate-spin" />
          </span>
          <span className="min-w-0">
            <span className="rf-read-face block truncate text-[13.5px] font-semibold text-white">Starting {name ? avdLabel(name) : "the emulator"}</span>
            <span className="rf-read-face block text-[12px] text-white/60">About a minute. It opens in its own window too.</span>
          </span>
        </div>
        <ProgressBar value={null} />
      </div>
    );
  }

  const canStart = avds.length > 0;
  return (
    <div className="flex w-full flex-col gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left" data-emulator-off>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/70 ring-1 ring-inset ring-white/10">
          <Smartphone size={17} />
        </span>
        <span className="min-w-0">
          <span className="rf-read-face block text-[13.5px] font-semibold text-white">The Android emulator is off</span>
          <span className="rf-read-face block text-[12px] text-white/60">
            {canStart ? (avds.length > 1 ? "Pick the phone to start." : `Starts ${avdLabel(avd)}.`) : info.avds ? "No virtual phone was found on this Mac. Make one in Android Studio first." : (info.reason ?? "Start it, then check again.")}
          </span>
        </span>
      </div>
      {canStart && avds.length > 1 && (
        <select
          aria-label="Phone to start"
          className="h-9 w-full rounded-xl border border-white/10 bg-black/30 px-2.5 text-[12.5px] text-white focus:border-sys-pink focus:outline-none"
          value={avd}
          onChange={(e) => setPicked(e.target.value)}
          data-emulator-pick
        >
          {avds.map((name) => (
            <option key={name} value={name}>
              {avdLabel(name)}
            </option>
          ))}
        </select>
      )}
      {failed && (
        <p className="rf-read-note rf-error" role="alert" data-emulator-error>
          {failed}
        </p>
      )}
      <div className="flex items-center gap-3">
        {canStart && (
          <button
            type="button"
            className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange px-4 text-[13px] font-bold tracking-wide text-white shadow-lg shadow-sys-pink/25 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.985]"
            onClick={() => {
              const api = phoneBridge();
              if (!api) return;
              onStart?.();
              void startEmulator(api, avd || undefined);
            }}
            data-emulator-start
          >
            <Power size={15} /> Start emulator
          </button>
        )}
        <button type="button" className="rf-read-face shrink-0 text-[12px] text-white/60 underline hover:text-white" onClick={onCheck} data-emulator-check>
          Check again
        </button>
      </div>
    </div>
  );
}
