"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input, textareaClass } from "@/components/ui/Field";
import { parsePeople, phoneBridge, type ReelOptions, type ReelOutcome } from "@/lib/phone/phoneBridge";
import { loadReelChoices, saveReelChoices, typeableNote } from "@/lib/phone/reelChoices";

/** Seconds the final Instagram screen is shown before Share is tapped, with a button to cancel. */
const SHARE_COUNTDOWN = 6;

type Phase = { kind: "form" } | { kind: "running"; label: string } | { kind: "countdown"; left: number; outcome: ReelOutcome } | { kind: "done"; headline: string; outcome: ReelOutcome | null; ok: boolean };

function Check({ checked, onChange, label, hint, name }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; name: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--sys-blue,#0a84ff)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-reel-check={name} />
      <span>
        <span className="block text-[13px] text-white">{label}</span>
        <span className="block text-[12px] text-label-2">{hint}</span>
      </span>
    </label>
  );
}

/**
 * The Post / Reel window: what Instagram should be walked through on the phone, then Go.
 * `prepare` copies the video to the phone (once) and returns its gallery address.
 */
export function PostReelDialog({ open, onClose, prepare }: { open: boolean; onClose: () => void; prepare: (onLabel: (label: string) => void) => Promise<string> }) {
  const saved = useRef(loadReelChoices());
  const [keepFull, setKeepFull] = useState(saved.current.keepFull);
  const [next, setNext] = useState(saved.current.next);
  const [share, setShare] = useState(saved.current.share);
  const [overlay, setOverlay] = useState("");
  const [caption, setCaption] = useState("");
  const [location, setLocation] = useState(saved.current.location);
  const [people, setPeople] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [ai, setAi] = useState<{ available: boolean; busy: boolean; error: string | null; before: string | null }>({ available: false, busy: false, error: null, before: null });
  const cancelled = useRef(false);

  // The window can be taken away mid-run (another tool opened, the project closed): the steps stop
  // then, and nothing is shared (the countdown's timer goes with the window).
  const running = useRef(false);
  useEffect(
    () => () => {
      if (!running.current) return;
      cancelled.current = true;
      void phoneBridge()?.cancel().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let gone = false;
    void window.nocapDesktop?.caption
      ?.info()
      .then((i) => !gone && setAi((a) => ({ ...a, available: i.available })))
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [open]);

  // The countdown before Share: the final screen is on the phone panel; Cancel leaves it there.
  useEffect(() => {
    if (phase.kind !== "countdown") return;
    if (phase.left > 0) {
      const t = setTimeout(() => setPhase((p) => (p.kind === "countdown" ? { ...p, left: p.left - 1 } : p)), 1000);
      return () => clearTimeout(t);
    }
    const outcome = phase.outcome;
    const api = phoneBridge();
    setPhase({ kind: "running", label: "Sharing the reel (Instagram can take a minute)" });
    void (async () => {
      try {
        const r = await api!.share();
        setPhase({ kind: "done", ok: r.shared, outcome, headline: r.shared ? "Shared. Instagram is uploading the reel." : "Share was tapped, but Instagram was still on the caption screen 90 seconds later, so it may not have posted. Look at the phone panel before sharing again, or it could post twice." });
      } catch (e) {
        setPhase({ kind: "done", ok: false, outcome, headline: e instanceof Error ? e.message : "Share could not be tapped. Finish in the phone panel." });
      }
    })();
  }, [phase]);

  const polish = async () => {
    const api = window.nocapDesktop?.caption;
    if (!api || !caption.trim()) return;
    setAi((a) => ({ ...a, busy: true, error: null }));
    try {
      const better = await api.polish(caption);
      setAi((a) => ({ ...a, busy: false, before: caption }));
      setCaption(better);
    } catch (e) {
      setAi((a) => ({ ...a, busy: false, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The caption could not be polished." }));
    }
  };

  const go = async () => {
    const api = phoneBridge();
    if (!api) return;
    cancelled.current = false;
    running.current = true;
    saveReelChoices({ keepFull, next, share, location });
    const options: ReelOptions = { keepFull, next, overlay: overlay.trim(), caption: caption.trim(), location: location.trim(), people: parsePeople(people) };
    setPhase({ kind: "running", label: "Sending the video to the phone" });
    api.onStep((label) => setPhase((p) => (p.kind === "running" ? { kind: "running", label } : p)));
    try {
      const uri = await prepare((label) => setPhase({ kind: "running", label }));
      if (cancelled.current) throw new Error("Stopped.");
      const outcome = await api.reel(uri, options);
      if (outcome.ready && share && !cancelled.current) setPhase({ kind: "countdown", left: SHARE_COUNTDOWN, outcome });
      else if (outcome.ready) setPhase({ kind: "done", ok: true, outcome, headline: "Ready on the caption screen. Tap Share in the phone panel when you want to post." });
      else if (outcome.stoppedAt === "trim") setPhase({ kind: "done", ok: true, outcome, headline: "Instagram's trim tools are open. Finish in the phone panel." });
      else if (outcome.stoppedAt === "editor") setPhase({ kind: "done", ok: true, outcome, headline: "Stopped on the Reel editor. Finish in the phone panel." });
      else if (outcome.stoppedAt === "cancelled") setPhase({ kind: "done", ok: false, outcome, headline: "Stopped. Instagram is where it was left, in the phone panel." });
      else setPhase({ kind: "done", ok: false, outcome, headline: outcome.error ?? "A step failed. Finish in the phone panel." });
    } catch (e) {
      setPhase({ kind: "done", ok: false, outcome: null, headline: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The emulator did not answer." });
    } finally {
      running.current = false;
      api.onStep(null);
    }
  };

  const stop = () => {
    cancelled.current = true;
    void phoneBridge()?.cancel();
  };
  const close = () => {
    if (phase.kind === "running" || phase.kind === "countdown") stop();
    setPhase({ kind: "form" });
    onClose();
  };

  const captionNote = typeableNote(caption);
  const busy = phase.kind === "running" || phase.kind === "countdown";

  if (!open) return null;
  // On the page itself, not inside the Export column, which would show through it and box it in.
  return createPortal(
    // A floating window with no backdrop, on the left: the phone panel on the right has to stay in view while this runs.
    <div
      role="dialog"
      aria-label="Post / Reel"
      style={{ background: "var(--color-sys-gray6)" }}
      className="card fixed left-6 top-20 z-50 flex max-h-[calc(100vh-7rem)] w-[30rem] max-w-[calc(100vw-3rem)] flex-col shadow-2xl"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      data-reel-dialog
    >
      <h3 className="flex items-center border-b border-sys-gray4 px-4 py-2.5 text-[14px] font-semibold text-white">
        Post / Reel
        <button type="button" onClick={close} className="ml-auto rounded p-0.5 text-label-3 hover:bg-sys-gray4 hover:text-white" aria-label="Close" data-reel-close>
          <X size={16} />
        </button>
      </h3>
      <div className="space-y-3.5 overflow-y-auto p-4">
        <fieldset disabled={busy} className="space-y-3.5 disabled:opacity-60">
          <Check name="keepFull" checked={keepFull} onChange={setKeepFull} label="Keep the full clip" hint="Off: stop on Instagram's trim tools so you can cut it there." />
          <Field label="Text on the video" hint="Optional. Typed into Instagram's Text tool, in the middle of the picture.">
            <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="Friday night open mic" maxLength={200} data-reel-overlay />
          </Field>
          <Check name="next" checked={next} onChange={setNext} label="Tap Next" hint="Off: stop on the Reel editor, before the caption screen." />
          <Field
            label="Caption"
            hint={captionNote ?? "Rough notes are fine: date, place, who. AI polish turns them into a finished caption you can edit."}
            right={
              ai.available ? (
                <span className="flex items-center gap-1.5">
                  {ai.before !== null && (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-label-2 hover:text-white"
                      onClick={() => {
                        setCaption(ai.before ?? "");
                        setAi((a) => ({ ...a, before: null }));
                      }}
                      data-reel-polish-undo
                    >
                      <Undo2 size={11} /> My notes
                    </button>
                  )}
                  <button type="button" className="inline-flex items-center gap-1 font-semibold text-sys-blue hover:underline disabled:opacity-50" onClick={() => void polish()} disabled={ai.busy || !caption.trim()} data-reel-polish>
                    <Sparkles size={11} /> {ai.busy ? "Polishing" : "AI polish"}
                  </button>
                </span>
              ) : undefined
            }
          >
            <textarea className={`${textareaClass} min-h-28`} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Nov 28, open mic, 12 comics, packed room" maxLength={2200} data-reel-caption />
          </Field>
          {ai.error && <p className="rf-read-note rf-error">{ai.error}</p>}
          <Field label="Location" hint="Optional. Searched in Instagram; the exact match, or else the first result, is picked.">
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Name of the venue" maxLength={80} data-reel-location />
          </Field>
          <Field label="Tag people" hint="Optional. Usernames, separated by spaces. Only an exact username is tagged.">
            <Input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="@name @another" data-reel-people />
          </Field>
          <Check name="share" checked={share} onChange={setShare} label="Tap Share" hint={`Posts publicly, and also to Threads and Facebook if Instagram's "Also share on" switches are on. The final screen shows for ${SHARE_COUNTDOWN} seconds first, with a button to cancel. Off: stop on the caption screen.`} />
        </fieldset>

        {phase.kind === "running" && (
          <p className="rf-read-note" data-reel-status>
            {phase.label}…
          </p>
        )}
        {phase.kind === "countdown" && (
          <div className="space-y-2 rounded-lg border border-sys-orange/40 bg-sys-orange/10 p-2.5" data-reel-countdown>
            <p className="rf-read-note">Everything is filled in. Check the phone panel, including &ldquo;Also share on&rdquo; further down. Tapping Share in {phase.left} s.</p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setPhase({ kind: "done", ok: true, outcome: phase.outcome, headline: "Not shared. Instagram is on the caption screen; tap Share in the phone panel when you want to post." })}
              data-reel-countdown-cancel
            >
              Cancel, do not share
            </Button>
          </div>
        )}
        {phase.kind === "done" && (
          <div className={`space-y-1 rounded-lg border p-2.5 ${phase.ok ? "border-sys-green/40 bg-sys-green/10" : "border-sys-red/40 bg-sys-red/10"}`} data-reel-result>
            <p className={`rf-read-note ${phase.ok ? "rf-ok" : "rf-error"}`}>{phase.headline}</p>
            {phase.outcome?.notes.map((n) => (
              <p key={n} className="rf-read-note [overflow-wrap:anywhere]">
                {n}
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {phase.kind === "running" ? (
            <Button variant="outline" size="sm" onClick={stop} data-reel-stop>
              Stop
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={close}>
              Close
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => void go()} disabled={busy} data-reel-go>
            {phase.kind === "done" ? "Go again" : "Go"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
