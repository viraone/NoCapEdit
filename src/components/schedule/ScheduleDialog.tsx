"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, Image as ImageIcon, Link2, Music, PlusCircle, Send, Star, Type } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";
import { typeableNote } from "@/lib/phone/reelChoices";
import type { StorySlot } from "@/lib/phone/phoneBridge";
import { scheduleBridge, type ScheduleDraft, type ScheduleOptions, type ScheduleResult, type ScheduleState, type ScheduleStatus, type ScheduledItem, type ScheduleWanted } from "@/lib/schedule/scheduleBridge";
import { fromLocalInput, nextHour, statusLabel, summaryLines, toLocalInput, whenText } from "@/lib/schedule/scheduleForm";
import { useScheduleWindow } from "@/lib/schedule/scheduleStore";
import { Card, DialogHeader, SwitchRow, dialogClass, goButtonClass, segment, segmentRow } from "@/components/phone/dialogParts";

const clean = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback);

/** A scheduled Story is never posted with words missing, so these are refused rather than left out. */
const CANNOT_TYPE = "Instagram's Text tool cannot type emoji or accents, so this cannot be scheduled with them. Take them out, or put them in the picture itself.";

type Screen = "list" | "form" | "review";

interface Pending {
  wanted: ScheduleWanted;
  draft: ScheduleDraft | null;
  changing: ScheduledItem | null;
}

type Confirm = { kind: "postNow" | "remove"; id: string };

/** A small picture of the picked file, drawn as a background so Next needs no image tag. */
function Thumb({ src, name, size = "h-14 w-14" }: { src: string; name: string; size?: string }) {
  if (src) {
    return <span role="img" aria-label={name} className={`shrink-0 rounded-xl bg-cover bg-center ring-1 ring-white/10 ${size}`} style={{ backgroundImage: `url("${src}")` }} />;
  }
  return (
    <span aria-hidden className={`grid shrink-0 place-items-center rounded-xl bg-white/[0.06] text-white/40 ring-1 ring-inset ring-white/10 ${size}`}>
      <ImageIcon size={18} />
    </span>
  );
}

/** Where a sticker or a line of text goes on the Story: top, middle or bottom. */
function SlotPicker({ value, onChange, name }: { value: StorySlot; onChange: (v: StorySlot) => void; name: string }) {
  return (
    <span className={segmentRow}>
      {(["top", "middle", "bottom"] as const).map((slot) => (
        <button
          key={slot}
          type="button"
          aria-pressed={value === slot}
          onClick={() => onChange(slot)}
          data-schedule-slot={`${name}-${slot}`}
          className={segment(value === slot)}
        >
          {slot === "top" ? "Top" : slot === "middle" ? "Middle" : "Bottom"}
        </button>
      ))}
    </span>
  );
}

function statusPill(status: ScheduleStatus): string {
  switch (status) {
    case "shared":
      return "rounded-full bg-sys-green/15 px-2 py-0.5 text-[11px] font-semibold text-sys-green";
    case "needsYou":
      return "rounded-full bg-sys-orange/15 px-2 py-0.5 text-[11px] font-semibold text-sys-orange";
    case "missed":
      return "rounded-full bg-sys-red/15 px-2 py-0.5 text-[11px] font-semibold text-sys-red";
    case "posting":
    case "sharing":
      return "animate-pulse rounded-full bg-sys-blue/15 px-2 py-0.5 text-[11px] font-semibold text-sys-blue";
    default:
      return "rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70";
  }
}

const smallAction = "rf-read-face inline-flex h-7 items-center rounded-full border border-white/10 bg-white/[0.03] px-2.5 text-[11.5px] font-medium text-white/75 transition-colors enabled:hover:border-white/25 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-45";

/**
 * The Schedule window (desktop app only): Stories waiting to be posted by the app, and the form
 * for a new one. The host passes the queue and reloads it when it changes; the window never keeps
 * a queue of its own.
 */
export function ScheduleDialog({ state, onRefresh }: { state: ScheduleState | null; onRefresh?: () => void }) {
  const hide = useScheduleWindow((s) => s.hide);
  const [screen, setScreen] = useState<Screen>("list");
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const [changing, setChanging] = useState<ScheduledItem | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** A clock for Today / Tomorrow, refreshed every 20 seconds; 0 until the first tick. */
  const [now, setNow] = useState(0);

  const heldId = changing?.id ?? (confirm?.kind === "remove" ? confirm.id : null);
  useEffect(() => {
    if (!heldId) return;
    return () => {
      void scheduleBridge()?.release(heldId).catch(() => undefined);
    };
  }, [heldId]);

  const [atText, setAtText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [linkAt, setLinkAt] = useState<StorySlot>("bottom");
  const [overlay, setOverlay] = useState("");
  const [overlayAt, setOverlayAt] = useState<StorySlot>("top");
  const [musicTitle, setMusicTitle] = useState("");
  const [musicArtist, setMusicArtist] = useState("");
  const [mute, setMute] = useState(false);
  const [audience, setAudience] = useState<"story" | "close">("story");
  const [highlight, setHighlight] = useState("");

  /** The picked file that has not been scheduled yet, so leaving the form can throw it away. */
  const draftRef = useRef<ScheduleDraft | null>(null);
  /** The app is taking the draft right now; it must not be thrown away under it. */
  const inFlightRef = useRef(false);

  useEffect(
    () => () => {
      const gone = draftRef.current;
      if (!gone || inFlightRef.current) return;
      draftRef.current = null;
      void scheduleBridge()?.discard(gone.draftId).catch(() => undefined);
    },
    [],
  );

  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 20_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  const wantsSong = musicTitle.trim() !== "" && musicArtist.trim() !== "";
  const halfSong = (musicTitle.trim() !== "") !== (musicArtist.trim() !== "");
  const source = draft?.source ?? changing?.source ?? "video";
  const isPicture = source === "picture";
  const name = draft?.name ?? changing?.name ?? "Story";
  const thumb = draft?.thumb ?? changing?.thumb ?? "";

  const dropDraft = () => {
    const gone = draftRef.current;
    if (!gone || inFlightRef.current) return;
    draftRef.current = null;
    setDraft(null);
    void scheduleBridge()?.discard(gone.draftId).catch(() => undefined);
  };

  const close = () => {
    dropDraft();
    hide();
  };

  const openForm = (nextDraft: ScheduleDraft | null, item: ScheduledItem | null) => {
    if (item) {
      setAtText(toLocalInput(item.at));
      setLinkUrl(item.options.linkUrl);
      setLinkLabel(item.options.linkLabel);
      setLinkAt(item.options.linkAt);
      setOverlay(item.options.overlay);
      setOverlayAt(item.options.overlayAt);
      setMusicTitle(item.options.music?.title ?? "");
      setMusicArtist(item.options.music?.artist ?? "");
      setMute(item.options.mute);
      setAudience(item.audience);
      setHighlight(item.highlight);
    } else {
      setAtText(toLocalInput(nextHour(Date.now())));
      setLinkUrl("");
      setLinkLabel("");
      setLinkAt("bottom");
      setOverlay("");
      setOverlayAt("top");
      setMusicTitle("");
      setMusicArtist("");
      setMute(false);
      setAudience("story");
      setHighlight("");
    }
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setChanging(item);
    setPending(null);
    setConfirm(null);
    setError(null);
    setScreen("form");
  };

  const backToList = () => {
    dropDraft();
    setChanging(null);
    setPending(null);
    setConfirm(null);
    setError(null);
    setScreen("list");
  };

  const pick = async () => {
    const api = scheduleBridge();
    if (!api || busy) return;
    setBusy("pick");
    setError(null);
    try {
      const picked = await api.pick();
      if (!picked) return;   // cancelled
      openForm(picked, null);
    } catch (e) {
      setError(clean(e, "The file window could not be opened."));
    } finally {
      setBusy(null);
    }
  };

  const run = async (what: string, fn: () => Promise<ScheduleResult>) => {
    setBusy(what);
    setError(null);
    try {
      const result = await fn();
      if (!result.ok) setError(result.why);
      else onRefresh?.();
    } catch (e) {
      setError(clean(e, "The app did not answer."));
    } finally {
      setBusy(null);
    }
  };

  const postNow = (item: ScheduledItem) => setConfirm({ kind: "postNow", id: item.id });

  const change = async (item: ScheduledItem) => {
    const api = scheduleBridge();
    if (!api) return;
    setError(null);
    try {
      const result = await api.hold(item.id);
      if (!result.ok) {
        setError(result.why);
        return;
      }
      openForm(null, item);
    } catch (e) {
      setError(clean(e, "The app did not answer."));
    }
  };

  const remove = async (item: ScheduledItem) => {
    const api = scheduleBridge();
    if (!api) return;
    if (item.status === "scheduled") {
      setError(null);
      try {
        const result = await api.hold(item.id);
        if (!result.ok) {
          setError(result.why);
          return;
        }
        setConfirm({ kind: "remove", id: item.id });
      } catch (e) {
        setError(clean(e, "The app did not answer."));
      }
      return;
    }
    void run("remove", () => api.remove(item.id));
  };

  const yes = () => {
    const api = scheduleBridge();
    const asked = confirm;
    if (!api || !asked) return;
    setConfirm(null);
    void run(asked.kind, () => (asked.kind === "postNow" ? api.postNow(asked.id) : api.remove(asked.id)));
  };

  const togglePause = async () => {
    const api = scheduleBridge();
    if (!api || busy) return;
    setBusy("pause");
    setError(null);
    try {
      await api.setPaused(!(state?.paused ?? false));
      onRefresh?.();
    } catch (e) {
      setError(clean(e, "The app did not answer."));
    } finally {
      setBusy(null);
    }
  };

  const stop = () => {
    const api = scheduleBridge();
    if (!api) return;
    setError(null);
    void api.stop().catch((e) => setError(clean(e, "The app did not answer.")));
  };

  const review = () => {
    if (halfSong) return;
    const at = fromLocalInput(atText);
    if (at === null) {
      setError("Pick a day and time.");
      return;
    }
    const options: ScheduleOptions = {
      mute: wantsSong ? true : isPicture ? false : mute,
      overlay: overlay.trim(),
      overlayAt,
      linkUrl: linkUrl.trim(),
      linkLabel: linkLabel.trim(),
      linkAt,
      music: wantsSong ? { title: musicTitle.trim(), artist: musicArtist.trim() } : null,
    };
    setError(null);
    setPending({ wanted: { at, audience, highlight: highlight.trim(), options }, draft, changing });
    setScreen("review");
  };

  const backToForm = () => {
    setError(null);
    setScreen("form");
  };

  const schedule = async () => {
    const api = scheduleBridge();
    if (!api || !pending || busy) return;
    setBusy("schedule");
    setError(null);
    inFlightRef.current = true;
    try {
      const result = pending.changing
        ? await api.change(pending.changing.id, pending.wanted)
        : pending.draft
          ? await api.add(pending.draft.draftId, pending.wanted)
          : null;
      if (!result) {
        setError("Nothing to schedule.");
        return;
      }
      if (!result.ok) {
        setError(result.why);
        return;
      }
      // The app owns the file now, so closing the window must not throw it away.
      if (pending.draft) {
        draftRef.current = null;
        setDraft(null);
      }
      setPending(null);
      setChanging(null);
      setScreen("list");
      onRefresh?.();
    } catch (e) {
      setError(clean(e, "The app did not answer."));
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  };

  const when = (at: number) => (now ? whenText(at, now) : "—");

  const errorNote = error && (
    <p className="rf-read-note rf-error [overflow-wrap:anywhere]" data-schedule-error role="alert">
      {error}
    </p>
  );

  const items = state?.items ?? [];

  return createPortal(
    // A floating window on the left, like the Story window: the phone panel on the right stays in view.
    <div
      role="dialog"
      aria-label="Schedule"
      style={{ background: "var(--color-sys-gray6)" }}
      className={dialogClass}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") close();
      }}
      data-schedule-dialog
    >
      <DialogHeader icon={<CalendarClock size={20} />} title="Schedule" subtitle="Stories the app posts for you." onClose={close} closeData={{ "data-schedule-close": "" }} />

      <div className="min-h-0 overflow-y-auto p-3">
        {screen === "list" && (
          <div className="space-y-2.5">
            <p className="rf-read-note rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              The app posts these through the Android emulator. Keep this Mac awake and NoCap Edit open (closing the window is fine). More than 30 minutes late, a Story is not posted.
            </p>

            <SwitchRow
              data={{ "data-schedule-pause": "" }}
              checked={state?.paused ?? false}
              onChange={() => void togglePause()}
              disabled={!state || !!busy}
              label="Pause all"
              hint={state?.paused ? "Everything is paused. Turn this off to resume." : "Turn on to stop every scheduled Story from posting."}
            />

            {!state && <p className="rf-read-note animate-pulse">Reading the queue…</p>}

            {state && items.length === 0 && (
              <p className="rf-read-note rounded-2xl border border-dashed border-white/15 p-3">Nothing is scheduled yet. Press New Story to pick a picture or a video.</p>
            )}

            {items.map((item) => {
              const running = state?.running === item.id || item.status === "posting" || item.status === "sharing";
              const asked = confirm?.id === item.id ? confirm : null;
              return (
                <div key={item.id} className="flex gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3" data-schedule-item={item.id}>
                  <Thumb src={item.thumb} name={item.name} />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-semibold text-white" title={item.name}>
                          {item.name}
                        </span>
                        <span className="rf-read-face block text-[12px] text-white/55">{when(item.at)}</span>
                      </span>
                      <span className={statusPill(item.status)}>{statusLabel(item)}</span>
                    </div>

                    {item.maybePosted && item.status !== "shared" && (
                      <p className="rf-read-note rf-warn" data-schedule-maybe>May already have been posted. Check Instagram.</p>
                    )}

                    {item.note && <p className="rf-read-note [overflow-wrap:anywhere]">{item.note}</p>}
                    {item.details.map((line, i) => (
                      <p key={`${item.id}-detail-${i}`} className="rf-read-note [overflow-wrap:anywhere]">
                        {line}
                      </p>
                    ))}

                    {running ? (
                      <div className="space-y-1.5">
                        <p className="rf-read-note animate-pulse" data-schedule-step>
                          {state?.step || "Working"}…
                        </p>
                        <Button variant="outline" size="xs" onClick={stop} data-schedule-action="stop">
                          Stop
                        </Button>
                      </div>
                    ) : asked ? (
                      <div className="space-y-2 rounded-xl border border-sys-orange/40 bg-sys-orange/10 p-2.5">
                        <p className="rf-read-note">
                          {asked.kind === "remove"
                            ? "Remove this Story? It will not be posted."
                            : item.maybePosted
                              ? "This may already have been posted. Check Instagram first. Post it again?"
                              : "Post to your story now?"}
                        </p>
                        <div className="flex items-center gap-2">
                          <Button variant="primary" size="xs" onClick={yes} disabled={!!busy} data-schedule-action="yes">
                            Yes
                          </Button>
                          <Button variant="ghost" size="xs" onClick={() => setConfirm(null)} disabled={!!busy} data-schedule-action="no">
                            No
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(item.status === "scheduled" || item.status === "needsYou" || item.status === "missed") && (
                          <>
                            <button type="button" className={smallAction} onClick={() => postNow(item)} disabled={!!busy} data-schedule-action="postNow">
                              Post now
                            </button>
                            <button type="button" className={smallAction} onClick={() => void change(item)} disabled={!!busy} data-schedule-action="change">
                              Change
                            </button>
                          </>
                        )}
                        {item.status === "scheduled" && (
                          <button
                            type="button"
                            className={smallAction}
                            onClick={() => {
                              const api = scheduleBridge();
                              if (api) void run("postpone", () => api.postpone(item.id));
                            }}
                            disabled={!!busy}
                            data-schedule-action="postpone"
                          >
                            +15 min
                          </button>
                        )}
                        {(item.status === "scheduled" || item.status === "needsYou" || item.status === "missed" || item.status === "shared") && (
                          <button type="button" className={smallAction} onClick={() => void remove(item)} disabled={!!busy} data-schedule-action="remove">
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {screen === "form" && (
          <fieldset disabled={!!busy} className="space-y-2.5 disabled:opacity-60">
            {changing && changing.status === "scheduled" && (
              <p className="rf-read-note rounded-2xl border border-sys-blue/40 bg-sys-blue/10 p-3" data-schedule-hold-note>This Story is on hold while you change it. It will not post until you leave this screen.</p>
            )}
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <Thumb src={thumb} name={name} size="h-16 w-16" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-white" title={name}>
                  {name}
                </span>
                <span className="rf-read-face block text-[12px] text-white/55">
                  {isPicture ? "Picture" : "Video"} · {changing ? "Changing what is scheduled" : "New Story"}
                </span>
              </span>
            </div>

            <Card icon={<CalendarClock size={16} />} tone="bg-sys-blue/15 text-sys-blue">
              <Field label="Day and time" hint="The app posts it at this time. Keep the Mac awake.">
                <Input type="datetime-local" value={atText} onChange={(e) => setAtText(e.target.value)} data-schedule-at />
              </Field>
            </Card>

            <Card icon={<Link2 size={16} />} tone="bg-sys-blue/15 text-sys-blue">
              <Field label="Link sticker" hint="Optional. A web address people can tap.">
                <Input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="example.com/tickets" maxLength={200} data-schedule-link />
              </Field>
              <Field label="Sticker words" hint={typeableNote(linkLabel) ? CANNOT_TYPE : "Shown in place of the address."} right={<SlotPicker value={linkAt} onChange={setLinkAt} name="link" />}>
                <Input value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} placeholder="SIGN UP NOW" maxLength={60} data-schedule-link-label />
              </Field>
            </Card>

            <Card icon={<Type size={16} />} tone="bg-sys-purple/15 text-sys-purple">
              <Field label="Text on the picture" hint={typeableNote(overlay) ? CANNOT_TYPE : "Optional. Typed with Instagram's Text tool."} right={<SlotPicker value={overlayAt} onChange={setOverlayAt} name="overlay" />}>
                <Input value={overlay} onChange={(e) => setOverlay(e.target.value)} placeholder="Friday night open mic" maxLength={200} data-schedule-overlay />
              </Field>
            </Card>

            <Card icon={<Music size={16} />} tone="bg-sys-pink/15 text-sys-pink">
              <Field label="Music from Instagram" hint="Optional. Instagram often silences a well-known song that is part of the video, so name it here and it is added with Instagram's own Music button.">
                <Input value={musicTitle} onChange={(e) => setMusicTitle(e.target.value)} placeholder="Song, e.g. Timber" maxLength={80} data-schedule-song />
              </Field>
              <Field label="Artist" hint={halfSong ? "Type both the song and the artist." : wantsSong ? "Picked only if Instagram has exactly this song by this artist. If not, nothing is shared and you pick it in the phone panel." : "One artist is enough, e.g. Pitbull."}>
                <Input value={musicArtist} onChange={(e) => setMusicArtist(e.target.value)} placeholder="Artist, e.g. Pitbull" maxLength={80} data-schedule-artist />
              </Field>
            </Card>

            <div className="space-y-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              {!isPicture && (
                <SwitchRow
                  data={{ "data-schedule-check": "mute" }}
                  checked={mute || wantsSong}
                  onChange={setMute}
                  disabled={wantsSong}
                  label="Mute the video's sound"
                  hint={wantsSong ? "On, because Instagram's song plays in place of the video's own sound." : "For a clip whose own sound you do not want."}
                />
              )}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-white">Share to</span>
                <span className={segmentRow}>
                  <button type="button" aria-pressed={audience === "story"} onClick={() => setAudience("story")} data-schedule-audience="story" className={segment(audience === "story")}>
                    Your story
                  </button>
                  <button type="button" aria-pressed={audience === "close"} onClick={() => setAudience("close")} data-schedule-audience="close" className={segment(audience === "close")}>
                    Close Friends
                  </button>
                </span>
              </div>
            </div>

            <Card icon={<Star size={16} />} tone="bg-sys-orange/15 text-sys-orange">
              <Field label="Highlight name" hint={highlight.trim() ? "After it is posted, the Story is added to the Highlight with exactly this name." : "Type the exact name of one of your Highlights. With no name it is not added."}>
                <Input value={highlight} onChange={(e) => setHighlight(e.target.value)} placeholder="Name of the Highlight" maxLength={60} data-schedule-highlight />
              </Field>
            </Card>
          </fieldset>
        )}

        {screen === "review" && pending && (
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              <Thumb src={pending.draft?.thumb ?? pending.changing?.thumb ?? ""} name={pending.draft?.name ?? pending.changing?.name ?? "Story"} size="h-16 w-16" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold text-white" title={pending.draft?.name ?? pending.changing?.name ?? "Story"}>
                  {pending.draft?.name ?? pending.changing?.name ?? "Story"}
                </span>
                <span className="rf-read-face block text-[12px] font-semibold text-sys-blue" data-schedule-when>
                  {when(pending.wanted.at)}
                </span>
              </span>
            </div>

            <div className="space-y-1 rounded-2xl border border-white/10 bg-white/[0.035] p-3">
              {summaryLines(pending.wanted).map((line) => (
                <p key={line} className="rf-read-face text-[13px] leading-snug text-white/80">
                  {line}
                </p>
              ))}
            </div>

            {pending.changing?.maybePosted && (
              <p className="rf-read-note rounded-2xl border border-sys-red/40 bg-sys-red/10 p-3 font-semibold" data-schedule-maybe>This may already have been posted. Check Instagram first: scheduling it again can post it twice.</p>
            )}

            <p className="rf-read-note rounded-2xl border border-sys-orange/40 bg-sys-orange/10 p-3">
              NoCap Edit will tap Share by itself at that time. If anything is not exactly as above, it will not share and will tell you.
            </p>
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2.5 border-t border-white/10 bg-black/20 p-3">
        {errorNote}
        {screen === "form" && !isPicture && !wantsSong && !mute && (
          <p className="rf-read-note rounded-2xl border border-sys-orange/40 bg-sys-orange/10 p-2.5">If this video has a well-known song in it, Instagram may post it silent.</p>
        )}

        <div className="flex items-center gap-2">
          {screen === "list" ? (
            <button type="button" onClick={() => void pick()} disabled={!!busy} data-schedule-new className={goButtonClass}>
              <PlusCircle size={15} /> {busy === "pick" ? "Choosing…" : "New Story"}
            </button>
          ) : (
            <>
              <Button variant="ghost" size="md" className="rounded-full px-5" onClick={screen === "review" ? backToForm : backToList} disabled={!!busy}>
                Back
              </Button>
              {screen === "review" ? (
                <button type="button" onClick={() => void schedule()} disabled={!!busy} data-schedule-confirm className={goButtonClass}>
                  <Send size={15} /> {busy === "schedule" ? "Scheduling…" : pending?.changing?.maybePosted ? "Schedule anyway" : "Schedule"}
                </button>
              ) : (
                <button type="button" onClick={review} disabled={!!busy || halfSong} data-schedule-review className={goButtonClass}>
                  <CalendarClock size={15} /> Review
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
