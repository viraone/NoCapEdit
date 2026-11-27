"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { scheduleBridge, type ScheduleBridge, type ScheduleResult, type ScheduleState } from "@/lib/schedule/scheduleBridge";
import { clockText, HEADS_UP_MS } from "@/lib/schedule/scheduleForm";
import { useScheduleWindow } from "@/lib/schedule/scheduleStore";
import { ScheduleDialog } from "./ScheduleDialog";

const clean = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback);

const subscribeNothing = () => () => {};

/**
 * Scheduled Stories (desktop app only): owns the app's queue subscription, shows the Schedule
 * window when asked, and keeps a small banner on screen while a Story is posting or one is about
 * to. Renders nothing on the website.
 */
export function ScheduleHost() {
  // False while rendering on the page's server side, true in the desktop app after it loads, so the
  // server and the first client render agree.
  const hasBridge = useSyncExternalStore(
    subscribeNothing,
    () => scheduleBridge() !== null,
    () => false,
  );
  const open = useScheduleWindow((s) => s.open);
  const [state, setState] = useState<ScheduleState | null>(null);
  const [now, setNow] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // The one subscription for the whole page.
  useEffect(() => {
    if (!hasBridge) return;
    const api = scheduleBridge();
    if (!api) return;
    let gone = false;
    void api
      .state()
      .then((s) => !gone && setState(s))
      .catch(() => undefined);
    api.onChange((s) => setState(s));
    api.onShow(() => useScheduleWindow.getState().show());
    return () => {
      gone = true;
      api.onChange(null);
      api.onShow(null);
    };
  }, [hasBridge]);

  // Opening the window reads the queue afresh, in case something changed while the app was busy.
  useEffect(() => {
    if (!hasBridge || !open) return;
    const api = scheduleBridge();
    if (!api) return;
    let gone = false;
    void api
      .state()
      .then((s) => !gone && setState(s))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [hasBridge, open]);

  // The heads-up looks five minutes ahead; a fresh clock every 20 seconds keeps that window moving.
  useEffect(() => {
    if (!hasBridge || open) return;
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [hasBridge, open]);

  if (!hasBridge) return null;

  const refresh = () => {
    const api = scheduleBridge();
    if (!api) return;
    void api
      .state()
      .then(setState)
      .catch(() => undefined);
  };

  const act = (fn: (api: ScheduleBridge) => Promise<ScheduleResult>) => {
    const api = scheduleBridge();
    if (!api) return;
    setError(null);
    void fn(api)
      .then((result) => {
        if (!result.ok) setError(result.why);
        else refresh();
      })
      .catch((e) => setError(clean(e, "The app did not answer.")));
  };

  const stop = () => {
    const api = scheduleBridge();
    if (!api) return;
    setError(null);
    void api
      .stop()
      .then(() => refresh())
      .catch((e) => setError(clean(e, "The app did not answer.")));
  };

  const items = state?.items ?? [];
  const running = state?.running ? items.find((i) => i.id === state.running) : items.find((i) => i.status === "posting" || i.status === "sharing");
  const headsUp =
    state && !state.paused && now > 0
      ? (items.filter((i) => i.status === "scheduled" && i.at - now <= HEADS_UP_MS).sort((a, b) => a.at - b.at)[0] ?? null)
      : null;

  return (
    <>
      {open && <ScheduleDialog state={state} onRefresh={refresh} />}

      {!open && (running || headsUp) && (
        <div role="status" className="fixed bottom-4 left-4 z-40 w-[26rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-white/15 bg-sys-gray6/95 p-3 shadow-2xl shadow-black/60 backdrop-blur" data-schedule-banner>
          {running ? (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="rf-read-face block truncate text-[13px] font-semibold text-white" data-schedule-banner-text>
                  Posting {running.name}: {state?.step || "Working"}
                </span>
                <span className="rf-read-face block text-[11px] text-white/55">The phone is doing this now.</span>
              </span>
              <Button variant="danger" size="xs" onClick={stop} data-schedule-banner-stop>
                Stop
              </Button>
            </div>
          ) : (
            headsUp && (
              <div className="space-y-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sys-blue/15 text-sys-blue">
                    <CalendarClock size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="rf-read-face block text-[13px] font-semibold text-white" data-schedule-banner-text>
                      {headsUp.name} posts at {clockText(headsUp.at)}
                    </span>
                    <span className="rf-read-face block text-[11px] text-white/55">The app will post it soon. Open the window to change or cancel it.</span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button variant="outline" size="xs" onClick={() => act((api) => api.postpone(headsUp.id))} data-schedule-banner-postpone>
                    Postpone 15 min
                  </Button>
                  <Button variant="ghost" size="xs" onClick={() => useScheduleWindow.getState().show()} data-schedule-banner-remove>
                    Remove...
                  </Button>
                  <Button variant="secondary" size="xs" onClick={() => useScheduleWindow.getState().show()} data-schedule-banner-open>
                    Open
                  </Button>
                </div>
              </div>
            )
          )}

          {error && (
            <p className="rf-read-note rf-error mt-2 [overflow-wrap:anywhere]" data-schedule-banner-error>
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
