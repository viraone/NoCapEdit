/**
 * The desktop app's queue of scheduled Instagram Stories (desktop/scheduleHost.mjs). The app, not
 * this page, keeps the queue and posts at the set time, so it works with the window closed.
 */
import type { StorySlot } from "@/lib/phone/phoneBridge";

export type ScheduleStatus = "scheduled" | "posting" | "sharing" | "shared" | "needsYou" | "missed";

export interface ScheduleOptions {
  mute: boolean;
  /** Typed with Instagram's Text tool: plain keyboard characters only. */
  overlay: string;
  overlayAt: StorySlot;
  linkUrl: string;
  linkLabel: string;
  linkAt: StorySlot;
  music: { title: string; artist: string } | null;
}

/** What the user chose in the form. `at` is milliseconds since 1970. */
export interface ScheduleWanted {
  at: number;
  audience: "story" | "close";
  /** The exact name of a Highlight to add the Story to after it is shared, or "". */
  highlight: string;
  options: ScheduleOptions;
}

export interface ScheduledItem extends ScheduleWanted {
  id: string;
  /** The picked file's name. */
  name: string;
  source: "picture" | "video";
  status: ScheduleStatus;
  /** Why it needs the user, or was missed. */
  note: string;
  /** What was done, and what did not happen. */
  details: string[];
  /** Share may have been tapped without the app learning what happened: check Instagram first. */
  maybePosted: boolean;
  createdAt: number;
  finishedAt: number | null;
  /** A small picture of it, as a data: address, or "". */
  thumb: string;
}

export interface ScheduleState {
  items: ScheduledItem[];
  paused: boolean;
  /** The id of the Story being posted right now. */
  running: string | null;
  /** What the phone is doing for it, e.g. "Adding the link sticker". */
  step: string;
}

/** A picked file the app has copied (and, for a picture, made into a short video), not yet scheduled. */
export interface ScheduleDraft {
  draftId: string;
  name: string;
  source: "picture" | "video";
  thumb: string;
}

export type ScheduleResult = { ok: true } | { ok: false; why: string };

export interface ScheduleBridge {
  state(): Promise<ScheduleState>;
  /** Opens the Mac's file window. Null when it was cancelled. Throws with a plain message. */
  pick(): Promise<ScheduleDraft | null>;
  /** Throws away a picked file that was not scheduled. */
  discard(draftId: string): Promise<void>;
  add(draftId: string, wanted: ScheduleWanted): Promise<ScheduleResult>;
  change(id: string, wanted: ScheduleWanted): Promise<ScheduleResult>;
  remove(id: string): Promise<ScheduleResult>;
  postNow(id: string): Promise<ScheduleResult>;
  /** 15 minutes later. */
  postpone(id: string): Promise<ScheduleResult>;
  setPaused(paused: boolean): Promise<void>;
  /** Stops the Story being posted, if Share has not been tapped yet. */
  stop(): Promise<void>;
  /** One listener: called with the new state after every change. */
  onChange(fn: ((state: ScheduleState) => void) | null): void;
  /** One listener: the app asks for the Schedule window (its menu, or a notification was clicked). */
  onShow(fn: (() => void) | null): void;
}

/** The queue, in the desktop app; null on the website. */
export function scheduleBridge(): ScheduleBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { nocapDesktop?: { schedule?: ScheduleBridge } }).nocapDesktop?.schedule ?? null;
}
