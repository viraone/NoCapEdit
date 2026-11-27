/**
 * The Schedule window's plain helpers: choosing a time, showing it, and saying in words what a
 * scheduled Story will do. No DOM and no bridge calls here, so they are easy to test.
 */
import type { StorySlot } from "@/lib/phone/phoneBridge";
import type { ScheduleStatus, ScheduleWanted, ScheduledItem } from "./scheduleBridge";

/** The next full hour is at least this far away; also the banner's heads-up. */
export const HEADS_UP_MS = 5 * 60_000;

/** The next local full hour (minutes and seconds zero) that is at least 5 minutes from `now`. */
export function nextHour(now: number): number {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  if (next.getTime() - now < HEADS_UP_MS) next.setHours(next.getHours() + 1);
  return next.getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `at` as the value of an <input type="datetime-local">, in this Mac's own time. */
export function toLocalInput(at: number): string {
  const d = new Date(at);
  return `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The time in an <input type="datetime-local"> value, in this Mac's own time, or null when the
 * text is not a real local date and time (an impossible date such as 31 February included).
 */
export function fromLocalInput(text: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  // A day that does not exist (31 February) rolls into the next month instead of failing.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date.getTime();
}

/** The clock time, e.g. "7:00 PM". */
export function clockText(at: number): string {
  const d = new Date(at);
  const hours = d.getHours();
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${pad(d.getMinutes())} ${hours < 12 ? "AM" : "PM"}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const sameDate = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today 7:00 PM", "Tomorrow 7:00 PM", or "Fri, Dec 4, 7:00 PM". */
export function whenText(at: number, now: number): string {
  const d = new Date(at);
  const n = new Date(now);
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  const time = clockText(at);
  if (sameDate(d, n)) return `Today ${time}`;
  if (sameDate(d, tomorrow)) return `Tomorrow ${time}`;
  return `${DAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}

const STATUS_LABELS: Record<ScheduleStatus, string> = {
  scheduled: "Waiting",
  posting: "Setting up",
  sharing: "Sharing",
  shared: "Shared",
  needsYou: "Needs you",
  missed: "Missed",
};

/** The short label beside a queued Story: Waiting, Setting up, Sharing, Shared, Needs you, Missed. */
export function statusLabel(item: Pick<ScheduledItem, "status"> | ScheduleStatus): string {
  return STATUS_LABELS[typeof item === "string" ? item : item.status];
}

const slotWords = (slot: StorySlot) => (slot === "top" ? "at the top" : slot === "middle" ? "in the middle" : "at the bottom");

/**
 * What the user is about to schedule, as plain lines for the Review step. Only the choices that
 * are set are listed; the audience is always one of them.
 */
export function summaryLines(wanted: ScheduleWanted): string[] {
  const o = wanted.options;
  const lines: string[] = [`Share to: ${wanted.audience === "close" ? "Close Friends" : "Your story"}.`];

  const linkUrl = o.linkUrl.trim();
  const linkLabel = o.linkLabel.trim();
  if (linkUrl) {
    lines.push(linkLabel ? `Link sticker: "${linkLabel}" to ${linkUrl}, ${slotWords(o.linkAt)}.` : `Link sticker: ${linkUrl}, ${slotWords(o.linkAt)}.`);
  }

  const overlay = o.overlay.trim();
  if (overlay) lines.push(`Text on the picture: "${overlay}", ${slotWords(o.overlayAt)}.`);

  if (o.music) lines.push(`Music from Instagram: "${o.music.title}" by ${o.music.artist}.`);

  if (o.mute || o.music) lines.push("The video's sound is muted.");

  const highlight = wanted.highlight.trim();
  if (highlight) lines.push(`Added to the Highlight "${highlight}".`);

  return lines;
}
