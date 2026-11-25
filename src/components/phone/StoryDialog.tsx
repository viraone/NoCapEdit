"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link2, PlusCircle, Send, Star, Type, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { phoneBridge, type ReelOutcome, type StoryOptions, type StorySlot } from "@/lib/phone/phoneBridge";
import { typeableNote } from "@/lib/phone/reelChoices";
import { loadStoryChoices, saveStoryChoices } from "@/lib/phone/storyChoices";

/** Seconds the finished Story is shown before Share is tapped, with a button to cancel. */
const SHARE_COUNTDOWN = 6;

type Phase = { kind: "form" } | { kind: "running"; label: string } | { kind: "countdown"; left: number; outcome: ReelOutcome } | { kind: "done"; headline: string; outcome: ReelOutcome | null; ok: boolean };

/** A rounded group with a small coloured icon beside its first caption. */
function Card({ icon, tone, children }: { icon: ReactNode; tone: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1 space-y-3">{children}</div>
    </div>
  );
}

/** One choice in a pill-shaped row; the chosen one is filled white. */
const segment = (on: boolean) => `rounded-full px-2.5 py-1 text-[12px] font-semibold normal-case transition-colors ${on ? "bg-white text-black shadow" : "text-white/60 enabled:hover:text-white"}`;
const segmentRow = "inline-flex items-center gap-0.5 rounded-full bg-black/40 p-0.5 ring-1 ring-inset ring-white/10";

function Check({ checked, onChange, label, hint, name }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; name: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-white">{label}</span>
        <span className="rf-read-face mt-0.5 block text-[12px] leading-snug text-white/55">{hint}</span>
      </span>
      <span className="relative h-6 w-11 shrink-0">
        <input type="checkbox" className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0" checked={checked} onChange={(e) => onChange(e.target.checked)} data-story-check={name} />
        <span className={`absolute inset-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-sys-pink/70 ${checked ? "bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange" : "bg-white/15"}`} />
        <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </span>
    </label>
  );
}

/** Where a sticker or a line of text goes on the Story: top, middle or bottom. */
function SlotPicker({ value, onChange, name }: { value: StorySlot; onChange: (v: StorySlot) => void; name: string }) {
  return (
    <span className={segmentRow}>
      <button
        type="button"
        aria-pressed={value === "top"}
        onClick={() => onChange("top")}
        data-story-slot={`${name}-top`}
        className={segment(value === "top")}
      >
        Top
      </button>
      <button
        type="button"
        aria-pressed={value === "middle"}
        onClick={() => onChange("middle")}
        data-story-slot={`${name}-middle`}
        className={segment(value === "middle")}
      >
        Middle
      </button>
      <button
        type="button"
        aria-pressed={value === "bottom"}
        onClick={() => onChange("bottom")}
        data-story-slot={`${name}-bottom`}
        className={segment(value === "bottom")}
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
  const [highlight, setHighlight] = useState(saved.current.highlight);
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
        setPhase({ kind: "running", label: "Sharing the Story (Instagram can take a minute)" });
        const r = await api!.shareStory(audience);
        const sharedLine = audience === "close" ? "Shared to Close Friends." : "Shared to your story.";
        if (!r.shared) {
          setPhase({
            kind: "done",
            ok: false,
            outcome,
            headline: "Share was tapped, but Instagram was still on the Story screen 90 seconds later, so it may not have posted. Look at the phone panel before sharing again, or it could post twice.",
          });
          return;
        }
        const into = highlight.trim();
        if (!into) {
          setPhase({ kind: "done", ok: true, outcome, headline: `${sharedLine} Instagram is uploading it.` });
          return;
        }
        // The Story is posted; now the Highlight, which has to wait for Instagram's upload to finish.
        running.current = true;
        api!.onStep((label) => setPhase((p) => (p.kind === "running" ? { kind: "running", label } : p)));
        setPhase({ kind: "running", label: "Opening your Story" });
        try {
          const h = await api!.highlight(into);
          setPhase({ kind: "done", ok: h.added, outcome, headline: `${sharedLine} ${h.note}` });
        } finally {
          running.current = false;
          api!.onStep(null);
        }
      } catch (e) {
        setPhase({
          kind: "done",
          ok: false,
          outcome,
          headline: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The Story could not be shared. Finish in the phone panel.",
        });
      }
    })();
  }, [phase, audience, highlight]);

  const go = async () => {
    const api = phoneBridge();
    if (!api) return;
    cancelled.current = false;
    running.current = true;
    saveStoryChoices({ mute, share, audience, linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(), linkAt, overlayAt, highlight: highlight.trim() });
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
      className="card fixed left-6 top-20 z-50 flex max-h-[calc(100vh-7rem)] w-[30rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-black/60"
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      data-story-dialog
    >
      <div className="h-1 shrink-0 bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange" />
      <div className="flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-linear-to-br from-sys-purple via-sys-pink to-sys-orange text-white shadow-lg shadow-sys-pink/25">
          <PlusCircle size={20} />
        </span>
        <h3 className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold tracking-wide text-white">Story</span>
          <span className="rf-read-face block text-[12px] font-normal text-white/55">Set it up, then press Go.</span>
        </h3>
        <button type="button" onClick={close} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/60 transition-colors hover:bg-white/15 hover:text-white" aria-label="Close" data-story-close>
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-3">
        <fieldset disabled={busy} className="space-y-2.5 disabled:opacity-60">
          <Card icon={<Link2 size={16} />} tone="bg-sys-blue/15 text-sys-blue">
            <Field label="Link sticker" hint="Optional. A web address people can tap.">
              <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="example.com/tickets" maxLength={200} data-story-link />
            </Field>
            <Field label="Sticker words" hint={typeableNote(linkLabel) ?? "Shown in place of the address."} right={<SlotPicker value={linkAt} onChange={setLinkAt} name="link" />}>
              <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="SIGN UP NOW" maxLength={60} data-story-link-label />
            </Field>
          </Card>
          <Card icon={<Type size={16} />} tone="bg-sys-purple/15 text-sys-purple">
            <Field label="Text on the picture" hint={typeableNote(overlay) ?? "Optional. Typed with Instagram's Text tool."} right={<SlotPicker value={overlayAt} onChange={setOverlayAt} name="overlay" />}>
              <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="Friday night open mic" maxLength={200} data-story-overlay />
            </Field>
          </Card>
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <Check name="mute" checked={mute} onChange={setMute} label="Mute the video's sound" hint="For a flyer or clip whose own sound you do not want." />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-white">Share to</span>
              <span className={segmentRow}>
                <button
                  type="button"
                  aria-pressed={audience === "story"}
                  onClick={() => setAudience("story")}
                  data-story-audience="story"
                  className={segment(audience === "story")}
                >
                  Your story
                </button>
                <button
                  type="button"
                  aria-pressed={audience === "close"}
                  onClick={() => setAudience("close")}
                  data-story-audience="close"
                  className={segment(audience === "close")}
                >
                  Close Friends
                </button>
              </span>
            </div>
            <Check name="share" checked={share} onChange={setShare} label="Tap Share" hint={`Shows the finished Story for ${SHARE_COUNTDOWN} seconds, with a cancel button, then posts it.`} />
          </div>
          <Card icon={<Star size={16} />} tone="bg-sys-orange/15 text-sys-orange">
            <Field
              label="Add to Highlight"
              hint={share ? "Optional. Exact name of one of your Highlights. Added after the upload, which can take a few minutes." : "Needs Tap Share on."}
            >
              <Input value={highlight} onChange={(e) => setHighlight(e.target.value)} placeholder="Name of the Highlight" maxLength={60} disabled={!share} data-story-highlight />
            </Field>
          </Card>
        </fieldset>
      </div>
      <div className="shrink-0 space-y-2.5 border-t border-white/10 bg-black/20 p-3">
        {phase.kind === "running" && (
          <p className="rf-read-note animate-pulse" data-story-status>
            {phase.label}…
          </p>
        )}
        {phase.kind === "countdown" && (
          <div className="space-y-2 rounded-2xl border border-sys-orange/40 bg-sys-orange/10 p-2.5" data-story-countdown>
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
          <div className={`space-y-1 rounded-2xl border p-2.5 max-h-40 overflow-y-auto ${phase.ok ? "border-sys-green/40 bg-sys-green/10" : "border-sys-red/40 bg-sys-red/10"}`} data-story-result>
            <p className={`rf-read-note ${phase.ok ? "rf-ok" : "rf-error"}`}>{phase.headline}</p>
            {phase.outcome?.notes.map((n) => (
              <p key={n} className="rf-read-note [overflow-wrap:anywhere]">
                {n}
              </p>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          {phase.kind === "running" ? (
            <Button variant="outline" size="md" onClick={stop} className="rounded-full px-5" data-story-stop>
              Stop
            </Button>
          ) : (
            <Button variant="ghost" size="md" onClick={close} className="rounded-full px-5">
              Close
            </Button>
          )}
          <button
            type="button"
            onClick={() => void go()}
            disabled={busy}
            data-story-go
            className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-linear-to-r from-sys-purple via-sys-pink to-sys-orange text-[14px] font-bold text-white shadow-lg shadow-sys-pink/25 transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
          >
            <Send size={15} /> {phase.kind === "done" ? "Go again" : "Go"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
