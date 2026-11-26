"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link2, PlusCircle, Send, Sparkles, Star, Type } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { giveHighlightCover } from "@/lib/phone/highlightCover";
import { afterRun } from "@/lib/phone/afterRun";
import { phoneBridge, type ReelOutcome, type StoryOptions, type StorySlot } from "@/lib/phone/phoneBridge";
import { typeableNote } from "@/lib/phone/reelChoices";
import { loadStoryChoices, saveStoryChoices } from "@/lib/phone/storyChoices";
import { Card, DialogHeader, SwitchRow, dialogClass, goButtonClass, segment, segmentRow } from "./dialogParts";

/** Seconds the finished Story is shown before Share is tapped, with a button to cancel. */
const SHARE_COUNTDOWN = 6;

type Run = { cancelled: boolean; busy: boolean };

type Phase = { kind: "form" } | { kind: "running"; label: string } | { kind: "countdown"; left: number; outcome: ReelOutcome } | { kind: "done"; headline: string; outcome: ReelOutcome | null; ok: boolean };

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
export function StoryDialog({ open, onClose, prepare, video, onStyle }: { open: boolean; onClose: () => void; prepare: (onLabel: (label: string) => void) => Promise<string>; video: Blob; /** Takes these words to the editor's Text tool to be styled; missing when the video is a picked file, which the editor cannot change. */ onStyle?: (text: string, slot: StorySlot, ai: boolean) => void }) {
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
  const [cover, setCover] = useState(saved.current.cover);
  /* eslint-enable react-hooks/refs */
  const [overlay, setOverlay] = useState("");
  /** Gemini has a key on this Mac, so it can be asked to pick a cover. */
  const [gemini, setGemini] = useState(false);
  /** DeepSeek steps in when Gemini is busy. */
  const [spare, setSpare] = useState(false);
  /** DeepSeek is set up, so Style it asks it for a look. */
  const [aiLook, setAiLook] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const runRef = useRef<Run | null>(null);

  // The window can be taken away mid-run (another tool opened, the project closed): the steps stop
  // then, and nothing is shared (the countdown's timer goes with the window).
  useEffect(
    () => () => {
      const run = runRef.current;
      if (!run?.busy) return;
      run.cancelled = true;
      void phoneBridge()?.cancel().catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    if (!open) return;
    let gone = false;
    void window.nocapDesktop?.caption
      ?.info()
      .then((i) => {
        if (gone) return;
        setGemini(i.available);
        setSpare(!!i.spare);
        setAiLook(!!i.style);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [open]);

  // The countdown before Share: the finished Story is on the phone panel; Cancel leaves it there.
  useEffect(() => {
    if (phase.kind !== "countdown") return;
    if (phase.left > 0) {
      const t = setTimeout(() => setPhase((p) => (p.kind === "countdown" ? { ...p, left: p.left - 1 } : p)), 1000);
      return () => clearTimeout(t);
    }
    const outcome = phase.outcome;
    const api = phoneBridge();
    const run = runRef.current;
    if (!run) return;
    void (async () => {
      const show = (p: Phase) => {
        if (runRef.current === run) setPhase(p);
      };
      run.busy = true;
      try {
        show({ kind: "running", label: "Sharing the Story (Instagram can take a minute)" });
        const r = await api!.shareStory(audience);
        const sharedLine = audience === "close" ? "Shared to Close Friends." : "Shared to your story.";
        if (!r.shared) {
          show({
            kind: "done",
            ok: false,
            outcome,
            headline: "Share was tapped, but Instagram was still on the Story screen 90 seconds later, so it may not have posted. Look at the phone panel before sharing again, or it could post twice.",
          });
          return;
        }
        const into = highlight.trim();
        if (!into) {
          show({ kind: "done", ok: true, outcome, headline: `${sharedLine} Instagram is uploading it.` });
          return;
        }
        if (run.cancelled) {
          show({ kind: "done", ok: true, outcome, headline: `${sharedLine} Stopped, so it was not added to a Highlight.` });
          return;
        }
        // The Story is posted; now the Highlight, which has to wait for Instagram's upload to finish.
        api!.onStep((label) => {
          if (runRef.current === run) setPhase((p) => (p.kind === "running" ? { kind: "running", label } : p));
        });
        show({ kind: "running", label: "Opening your Story" });
        const h = await api!.highlight(into);
        const ai = window.nocapDesktop?.caption;
        if (!h.added || !cover || !gemini || !ai || run.cancelled) {
          show({ kind: "done", ok: h.added, outcome, headline: `${sharedLine} ${h.note}` });
          return;
        }
        const c = await giveHighlightCover({
          video,
          name: into,
          pick: (frames) => ai.cover(frames),
          setCover: (name, jpeg) => api!.highlightCover(name, jpeg),
          onStep: (label) => show({ kind: "running", label }),
          stopped: () => run.cancelled,
        });
        show({ kind: "done", ok: c.set, outcome, headline: `${sharedLine} ${h.note} ${c.note}` });
      } catch (e) {
        show({
          kind: "done",
          ok: false,
          outcome,
          headline: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The Story could not be shared. Finish in the phone panel.",
        });
      } finally {
        run.busy = false;
        if (runRef.current === run && !run.cancelled) api!.onStep(null);
      }
    })();
  }, [phase, audience, highlight, cover, gemini, video]);

  const go = async () => {
    const api = phoneBridge();
    if (!api) return;
    const run: Run = { cancelled: false, busy: true };
    runRef.current = run;
    const show = (p: Phase) => {
      if (runRef.current === run) setPhase(p);
    };
    saveStoryChoices({ mute, share, audience, linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(), linkAt, overlayAt, highlight: highlight.trim(), cover });
    const options: StoryOptions = { mute, overlay: overlay.trim(), overlayAt, linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(), linkAt };
    show({ kind: "running", label: "Sending the video to the phone" });
    api.onStep((label) => {
      if (runRef.current === run) setPhase((p) => (p.kind === "running" ? { kind: "running", label } : p));
    });
    try {
      const uri = await prepare((label) => show({ kind: "running", label }));
      if (run.cancelled) throw new Error("Stopped.");
      const outcome = await api.story(uri, options);
      const next = afterRun(outcome, share, run.cancelled);
      if (next === "countdown") show({ kind: "countdown", left: SHARE_COUNTDOWN, outcome });
      else if (next === "ready") show({ kind: "done", ok: true, outcome, headline: "Ready on the Story screen. Share it in the phone panel when you want to post." });
      else if (next === "held") show({ kind: "done", ok: false, outcome, headline: "Not shared, because something did not go through. Check it in the phone panel, and share it there if it looks right." });
      else if (next === "stopped") show({ kind: "done", ok: false, outcome, headline: "Stopped. Instagram is where it was left, in the phone panel." });
      else show({ kind: "done", ok: false, outcome, headline: outcome.error ?? "A step failed. Finish in the phone panel." });
    } catch (e) {
      show({ kind: "done", ok: false, outcome: null, headline: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The emulator did not answer." });
    } finally {
      run.busy = false;
      if (runRef.current === run && !run.cancelled) api.onStep(null);
    }
  };

  const stop = () => {
    if (runRef.current) runRef.current.cancelled = true;
    void phoneBridge()?.cancel();
  };
  const close = () => {
    if (phase.kind === "running" || phase.kind === "countdown") stop();
    setPhase({ kind: "form" });
    onClose();
  };

  const styleIt = () => {
    const text = overlay.trim();
    if (!onStyle || !text) return;
    saveStoryChoices({ mute, share, audience, linkUrl: linkUrl.trim(), linkLabel: linkLabel.trim(), linkAt, overlayAt, highlight: highlight.trim(), cover });
    setOverlay("");   // otherwise Instagram would type the same words a second time
    setPhase({ kind: "form" });
    onClose();
    onStyle(text, overlayAt, aiLook);
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
      className={dialogClass}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      data-story-dialog
    >
      <DialogHeader icon={<PlusCircle size={20} />} title="Story" onClose={close} closeData={{ "data-story-close": "" }} />
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
            <Field label="Text on the picture" hint={(typeableNote(overlay) && onStyle ? "Instagram's Text tool cannot type emoji or accents. Press Style it to keep them." : typeableNote(overlay)) ?? "Optional. Typed with Instagram's Text tool."} right={<SlotPicker value={overlayAt} onChange={setOverlayAt} name="overlay" />}>
              <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="Friday night open mic" maxLength={200} data-story-overlay />
            </Field>
            {onStyle && (
              <div className="flex items-center gap-3">
                <button type="button" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-linear-to-r from-sys-purple to-sys-pink px-2.5 py-1 text-[11px] font-bold text-white transition enabled:hover:brightness-110 disabled:opacity-45" disabled={!overlay.trim()} onClick={styleIt} data-story-style>
                  <Sparkles size={11} /> Style it
                </button>
                <span className="rf-read-face text-[12px] leading-snug text-white/55">{aiLook ? "DeepSeek suggests a look, using these words and one frame of the video. See it on the preview, try another, or change it. The words become part of the video." : "Fonts, colours and size in the editor. The words become part of the video; emoji work too."}</span>
              </div>
            )}
          </Card>
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
            <SwitchRow data={{ "data-story-check": "mute" }} checked={mute} onChange={setMute} label="Mute the video's sound" hint="For a flyer or clip whose own sound you do not want." />
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
            <SwitchRow data={{ "data-story-check": "share" }} checked={share} onChange={setShare} label="Tap Share" hint={`Shows the finished Story for ${SHARE_COUNTDOWN} seconds, with a cancel button, then posts it.`} />
          </div>
          <Card icon={<Star size={16} />} tone="bg-sys-orange/15 text-sys-orange">
            <Field
              label="Add to Highlight"
              hint={share ? "Optional. Exact name of one of your Highlights. Added after the upload, which can take a few minutes." : "Needs Tap Share on."}
            >
              <Input value={highlight} onChange={(e) => setHighlight(e.target.value)} placeholder="Name of the Highlight" maxLength={60} disabled={!share} data-story-highlight />
            </Field>
            {gemini && (
              <SwitchRow
                data={{ "data-story-check": "cover" }}
                checked={cover}
                onChange={setCover}
                disabled={!share || !highlight.trim()}
                label="Gemini picks the cover"
                hint={share && highlight.trim() ? `Sends a few frames of this video to Gemini${spare ? " (DeepSeek if Gemini is busy)" : ""}, then replaces that Highlight's cover. Off leaves the cover as it is.` : "Needs a Highlight name above."}
              />
            )}
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
            {/* Under Cancel and scrolling on their own, so a long list never pushes Cancel off a small window. */}
            {phase.outcome.notes.length > 0 && (
              <div className="max-h-20 space-y-1 overflow-y-auto">
              {phase.outcome.notes.map((n) => (
                <p key={n} className="rf-read-note [overflow-wrap:anywhere]">
                  {n}
                </p>
              ))}
              </div>
            )}
          </div>
        )}
        {phase.kind === "done" && (
          <div className={`space-y-1 rounded-2xl border p-2.5 max-h-40 overflow-y-auto ${phase.ok ? "border-sys-green/40 bg-sys-green/10" : "border-sys-red/40 bg-sys-red/10"}`} data-story-result>
            <p className={`rf-read-note ${phase.ok ? "rf-ok" : "rf-error"}`}>{phase.headline}</p>
            {phase.outcome?.problems?.map((p) => (
              <p key={p} className="rf-read-note rf-warn [overflow-wrap:anywhere]">
                {p}
              </p>
            ))}
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
            className={goButtonClass}
          >
            <Send size={15} /> {phase.kind === "done" ? "Go again" : "Go"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
