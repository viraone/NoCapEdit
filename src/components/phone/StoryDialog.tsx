"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { phoneBridge, type ReelOutcome, type StoryOptions, type StorySlot } from "@/lib/phone/phoneBridge";
import { typeableNote } from "@/lib/phone/reelChoices";
import { loadStoryChoices, saveStoryChoices } from "@/lib/phone/storyChoices";

/** Seconds the finished Story is shown before Share is tapped, with a button to cancel. */
const SHARE_COUNTDOWN = 6;

type Phase = { kind: "form" } | { kind: "running"; label: string } | { kind: "countdown"; left: number; outcome: ReelOutcome } | { kind: "done"; headline: string; outcome: ReelOutcome | null; ok: boolean };

function Check({ checked, onChange, label, hint, name }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; name: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--sys-blue,#0a84ff)]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-story-check={name} />
      <span>
        <span className="block text-[13px] text-white">{label}</span>
        <span className="block text-[12px] text-label-2">{hint}</span>
      </span>
    </label>
  );
}

/** Where a sticker or a line of text goes on the Story: top, middle or bottom. */
function SlotPicker({ value, onChange, name }: { value: StorySlot; onChange: (v: StorySlot) => void; name: string }) {
  return (
    <span className="flex items-center gap-1">
      <button
        type="button"
        aria-pressed={value === "top"}
        onClick={() => onChange("top")}
        data-story-slot={`${name}-top`}
        className={`rounded-md border px-2 py-0.5 text-[12px] ${value === "top" ? "border-sys-blue text-white" : "border-sys-gray4 text-label-2 hover:text-white"}`}
      >
        Top
      </button>
      <button
        type="button"
        aria-pressed={value === "middle"}
        onClick={() => onChange("middle")}
        data-story-slot={`${name}-middle`}
        className={`rounded-md border px-2 py-0.5 text-[12px] ${value === "middle" ? "border-sys-blue text-white" : "border-sys-gray4 text-label-2 hover:text-white"}`}
      >
        Middle
      </button>
      <button
        type="button"
        aria-pressed={value === "bottom"}
        onClick={() => onChange("bottom")}
        data-story-slot={`${name}-bottom`}
        className={`rounded-md border px-2 py-0.5 text-[12px] ${value === "bottom" ? "border-sys-blue text-white" : "border-sys-gray4 text-label-2 hover:text-white"}`}
      >
        Bottom
      </button>
    </span>
  );
}

/**
 * The Story window: what Instagram should be walked through on the phone, then Go.
 * `prepare` copies the video to the phone (once) and returns its gallery address.
 */
export function StoryDialog({ open, onClose, prepare }: { open: boolean; onClose: () => void; prepare: (onLabel: (label: string) => void) => Promise<string> }) {
  const saved = useRef(loadStoryChoices());
  // The saved choices are read once, when the window first mounts. Newer React lint forbids reading a
  // ref during render even for this one-time read; the values below never change on later renders.
  /* eslint-disable react-hooks/refs */
  const [mute, setMute] = useState(saved.current.mute);
  const [share, setShare] = useState(saved.current.share);
  const [audience, setAudience] = useState<"story" | "close">(saved.current.audience);
  const [linkUrl, setLinkUrl] = useState(saved.current.linkUrl);
  const [linkLabel, setLinkLabel] = useState(saved.current.linkLabel);
  const [linkAt, setLinkAt] = useState<StorySlot>(saved.current.linkAt);
  const [overlayAt, setOverlayAt] = useState<StorySlot>(saved.current.overlayAt);
  /* eslint-enable react-hooks/refs */
  const [overlay, setOverlay] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
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

  // The countdown before Share: the finished Story is on the phone panel; Cancel leaves it there.
  useEffect(() => {
    if (phase.kind !== "countdown") return;
    if (phase.left > 0) {
      const t = setTimeout(() => setPhase((p) => (p.kind === "countdown" ? { ...p, left: p.left - 1 } : p)), 1000);
      return () => clearTimeout(t);
    }
    const outcome = phase.outcome;
    const api = phoneBridge();
    void (async () => {
      try {
        setPhase({ kind: "running", label: "Sharing the Story" });
        const r = await api!.shareStory(audience);
        setPhase({
          kind: "done",
          ok: r.shared,
          outcome,
          headline: r.shared ? (audience === "close" ? "Shared to Close Friends." : "Shared to your story.") : "Share was tapped, but the Story screen is still open. Check the phone panel.",
        });
      } catch (e) {
        setPhase({
          kind: "done",
          ok: false,
          outcome,
          headline: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The Story could not be shared. Finish in the phone panel.",
        });
      }
    })();
  }, [phase, audience]);

  const go = async () => {
    const api = phoneBridge();
    if (!api) return;
    cancelled.current = false;
    running.current = true;
    saveStoryChoices({ mute, share, audience, linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(), linkAt, overlayAt });
    const options: StoryOptions = { mute, overlay: overlay.trim(), overlayAt, linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(), linkAt };
    setPhase({ kind: "running", label: "Sending the video to the phone" });
    api.onStep((label) => setPhase((p) => (p.kind === "running" ? { kind: "running", label } : p)));
    try {
      const uri = await prepare((label) => setPhase({ kind: "running", label }));
      if (cancelled.current) throw new Error("Stopped.");
      const outcome = await api.story(uri, options);
      if (outcome.ready && share && !cancelled.current) setPhase({ kind: "countdown", left: SHARE_COUNTDOWN, outcome });
      else if (outcome.ready) setPhase({ kind: "done", ok: true, outcome, headline: "Ready on the Story screen. Share it in the phone panel when you want to post." });
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

  const busy = phase.kind === "running" || phase.kind === "countdown";

  if (!open) return null;
  // On the page itself, not inside the Export column, which would show through it and box it in.
  return createPortal(
    // A floating window with no backdrop, on the left: the phone panel on the right has to stay in view while this runs.
    <div
      role="dialog"
      aria-label="Story"
      style={{ background: "var(--color-sys-gray6)" }}
      className="card fixed left-6 top-20 z-50 flex max-h-[calc(100vh-7rem)] w-[30rem] max-w-[calc(100vw-3rem)] flex-col shadow-2xl"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      data-story-dialog
    >
      <h3 className="flex items-center border-b border-sys-gray4 px-4 py-2.5 text-[14px] font-semibold text-white">
        Story
        <button type="button" onClick={close} className="ml-auto rounded p-0.5 text-label-3 hover:bg-sys-gray4 hover:text-white" aria-label="Close" data-story-close>
          <X size={16} />
        </button>
      </h3>
      <div className="space-y-3.5 overflow-y-auto p-4">
        <fieldset disabled={busy} className="space-y-3.5 disabled:opacity-60">
          <Field label="Link sticker" hint="Optional. A web address people can tap. Leave empty for no sticker.">
            <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="example.com/tickets" maxLength={200} data-story-link />
          </Field>
          <Field label="Words on the sticker" hint={typeableNote(linkLabel) ?? "Optional. Shown on the sticker in place of the address."} right={<SlotPicker value={linkAt} onChange={setLinkAt} name="link" />}>
            <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="SIGN UP NOW" maxLength={60} data-story-link-label />
          </Field>
          <Field label="Text on the picture" hint={typeableNote(overlay) ?? "Optional. Typed into Instagram's Text tool."} right={<SlotPicker value={overlayAt} onChange={setOverlayAt} name="overlay" />}>
            <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="Friday night open mic" maxLength={200} data-story-overlay />
          </Field>
          <Check name="mute" checked={mute} onChange={setMute} label="Mute the video's sound" hint="For a flyer or clip whose own sound you do not want." />
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-white">Share to</span>
            <button
              type="button"
              aria-pressed={audience === "story"}
              onClick={() => setAudience("story")}
              data-story-audience="story"
              className={`rounded-md border px-2 py-0.5 text-[12px] ${audience === "story" ? "border-sys-blue text-white" : "border-sys-gray4 text-label-2 hover:text-white"}`}
            >
              Your story
            </button>
            <button
              type="button"
              aria-pressed={audience === "close"}
              onClick={() => setAudience("close")}
              data-story-audience="close"
              className={`rounded-md border px-2 py-0.5 text-[12px] ${audience === "close" ? "border-sys-blue text-white" : "border-sys-gray4 text-label-2 hover:text-white"}`}
            >
              Close Friends
            </button>
          </div>
          <Check name="share" checked={share} onChange={setShare} label="Tap Share" hint={`Posts the Story. The finished Story shows for ${SHARE_COUNTDOWN} seconds first, with a button to cancel. Off: stop with the Story ready on the phone.`} />
        </fieldset>

        {phase.kind === "running" && (
          <p className="rf-read-note" data-story-status>
            {phase.label}…
          </p>
        )}
        {phase.kind === "countdown" && (
          <div className="space-y-2 rounded-lg border border-sys-orange/40 bg-sys-orange/10 p-2.5" data-story-countdown>
            <p className="rf-read-note">Everything is on the Story. Check the phone panel. Sharing in {phase.left} s.</p>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setPhase({ kind: "done", ok: true, outcome: phase.outcome, headline: "Not shared. The Story is ready on the phone; share it there when you want to post." })}
              data-story-countdown-cancel
            >
              Cancel, do not share
            </Button>
          </div>
        )}
        {phase.kind === "done" && (
          <div className={`space-y-1 rounded-lg border p-2.5 ${phase.ok ? "border-sys-green/40 bg-sys-green/10" : "border-sys-red/40 bg-sys-red/10"}`} data-story-result>
            <p className={`rf-read-note ${phase.ok ? "rf-ok" : "rf-error"}`}>{phase.headline}</p>
            {phase.outcome?.notes.map((n) => (
              <p key={n} className="rf-read-note">
                {n}
              </p>
            ))}
          </div>
        )}

        <div className="flex justify-end gap-2">
          {phase.kind === "running" ? (
            <Button variant="outline" size="sm" onClick={stop} data-story-stop>
              Stop
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={close}>
              Close
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => void go()} disabled={busy} data-story-go>
            {phase.kind === "done" ? "Go again" : "Go"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
