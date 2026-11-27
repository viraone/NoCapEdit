import { cleanLinkUrl } from "./phone.mjs";

/**
 * @typedef {"top" | "middle" | "bottom"} Slot
 * @typedef {"scheduled" | "posting" | "sharing" | "shared" | "needsYou" | "missed"} Status
 * @typedef {{ mute: boolean, overlay: string, overlayAt: Slot, linkUrl: string, linkLabel: string, linkAt: Slot, music: { title: string, artist: string } | null }} StoryOptions
 * @typedef {{ at: number, audience: "story" | "close", highlight: string, options: StoryOptions }} Wanted
 * @typedef {Wanted & { id: string, name: string, source: "picture" | "video", status: Status, note: string, details: string[], warned: boolean, maybePosted: boolean, createdAt: number, finishedAt: number | null }} Item
 * @typedef {{ paused: boolean, lastSharedAt: number | null, items: Item[] }} Queue
 */

export const LATE_LIMIT_MS = 30 * 60_000;
export const HEADS_UP_MS = 5 * 60_000;
export const GAP_AFTER_SHARE_MS = 2 * 60_000;
export const POSTPONE_MS = 15 * 60_000;
export const MIN_LEAD_MS = 60_000;
export const MAX_AHEAD_MS = 365 * 24 * 60 * 60_000;

const SLOTS = ["top", "middle", "bottom"];
const STATUSES = ["scheduled", "posting", "sharing", "shared", "needsYou", "missed"];

/**
 * @param {unknown} value
 * @returns {string}
 */
function asString(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
function trimMax(value, max) {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * @param {unknown} value
 * @returns {Slot}
 */
function asSlot(value, fallback) {
  return SLOTS.includes(value) ? value : fallback;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function collapse(value) {
  return asString(value).replace(/\s+/g, " ").trim();
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function asNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * @returns {Queue}
 */
export function emptyQueue() {
  return { paused: false, lastSharedAt: null, items: [] };
}

/**
 * @param {unknown} raw
 * @param {number} now
 * @returns {{ ok: true, value: Wanted } | { ok: false, why: string }}
 */
export function parseWanted(raw, now) {
  if (typeof raw !== "object" || raw === null) return { ok: false, why: "Pick a day and time." };
  const at = raw.at;
  if (typeof at !== "number" || !Number.isFinite(at)) return { ok: false, why: "Pick a day and time." };
  if (at < now + MIN_LEAD_MS) return { ok: false, why: "Pick a time at least a minute from now." };
  if (at > now + MAX_AHEAD_MS) return { ok: false, why: "Pick a time within a year." };

  const options = typeof raw.options === "object" && raw.options !== null ? raw.options : {};

  const music = typeof options.music === "object" && options.music !== null ? options.music : null;
  const title = music ? collapse(music.title) : "";
  const artist = music ? collapse(music.artist) : "";
  if (music && ((title === "") !== (artist === ""))) {
    return { ok: false, why: "Type both the song and the artist." };
  }

  const linkUrl = trimMax(asString(options.linkUrl), 200);
  if (linkUrl !== "" && cleanLinkUrl(linkUrl) === null) {
    return { ok: false, why: "The link is not a web address the phone can type." };
  }

  const audience = raw.audience === "close" ? "close" : "story";
  const highlight = trimMax(asString(raw.highlight), 60);
  const overlay = trimMax(asString(options.overlay), 200);
  const overlayAt = asSlot(options.overlayAt, "top");
  const linkLabel = trimMax(asString(options.linkLabel), 60);
  const linkAt = asSlot(options.linkAt, "bottom");
  const musicValue = title !== "" && artist !== "" ? { title, artist } : null;
  const mute = options.mute === true || musicValue !== null;

  return {
    ok: true,
    value: {
      at,
      audience,
      highlight,
      options: { mute, overlay, overlayAt, linkUrl, linkLabel, linkAt, music: musicValue },
    },
  };
}

/**
 * @param {string} id
 * @param {string} name
 * @param {"picture" | "video"} source
 * @param {Wanted} value
 * @param {number} now
 * @returns {Item}
 */
export function newItem(id, name, source, value, now) {
  const trimmedName = trimMax(asString(name), 120);
  return {
    ...value,
    id,
    name: trimmedName === "" ? "Story" : trimmedName,
    source,
    status: "scheduled",
    note: "",
    details: [],
    warned: false,
    maybePosted: false,
    createdAt: now,
    finishedAt: null,
  };
}

/**
 * @param {Queue} queue
 * @param {number} now
 * @returns {{ queue: Queue, missed: Item[] }}
 */
export function markMissed(queue, now) {
  const missed = [];
  const items = queue.items.map((item) => {
    if (item.status === "scheduled" && now > item.at + LATE_LIMIT_MS) {
      const changed = {
        ...item,
        status: "missed",
        note: "Its time passed while the Mac or the app was off or busy. Nothing was posted.",
      };
      missed.push(changed);
      return changed;
    }
    return item;
  });
  if (missed.length === 0) return { queue, missed: [] };
  return { queue: { ...queue, items }, missed };
}

/**
 * @param {Queue} queue
 * @param {number} now
 * @returns {Item | null}
 */
export function dueItem(queue, now) {
  if (queue.paused) return null;
  if (queue.items.some((item) => item.status === "posting" || item.status === "sharing")) return null;
  if (queue.lastSharedAt !== null && now - queue.lastSharedAt < GAP_AFTER_SHARE_MS) return null;

  let best = null;
  for (const item of queue.items) {
    if (item.status !== "scheduled") continue;
    if (item.at > now || now > item.at + LATE_LIMIT_MS) continue;
    if (best === null || item.at < best.at) best = item;
  }
  return best;
}

/**
 * @param {Queue} queue
 * @param {number} now
 * @returns {Item[]}
 */
export function headsUp(queue, now) {
  if (queue.paused) return [];
  return queue.items.filter(
    (item) => item.status === "scheduled" && !item.warned && item.at - HEADS_UP_MS <= now && now < item.at,
  );
}

/**
 * @param {Queue} queue
 * @returns {Queue}
 */
export function recover(queue) {
  const items = queue.items.map((item) => {
    if (item.status === "posting") {
      return {
        ...item,
        status: "needsYou",
        maybePosted: false,
        note: "The app closed while this was being set up. Nothing was shared.",
      };
    }
    if (item.status === "sharing") {
      return {
        ...item,
        status: "needsYou",
        maybePosted: true,
        note: "The app closed while this was being shared. Check Instagram before posting it again.",
      };
    }
    return item;
  });
  return { ...queue, items };
}

/**
 * @param {Item} item
 * @param {number} now
 * @returns {Item}
 */
export function postponed(item, now) {
  if (item.status !== "scheduled") return item;
  return { ...item, at: Math.max(item.at, now) + POSTPONE_MS, warned: false };
}

/**
 * @param {Queue} queue
 * @returns {boolean}
 */
export function keepsRunning(queue) {
  if (queue.items.some((item) => item.status === "posting" || item.status === "sharing")) return true;
  if (!queue.paused && queue.items.some((item) => item.status === "scheduled")) return true;
  return false;
}

/**
 * @param {string} text
 * @returns {Queue | null}
 */
export function parseQueue(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  if (!Array.isArray(raw.items)) return null;

  const items = [];
  for (const entry of raw.items) {
    if (typeof entry !== "object" || entry === null) continue;
    if (typeof entry.id !== "string" || !/^[A-Za-z0-9_-]{1,40}$/.test(entry.id)) continue;
    if (typeof entry.at !== "number" || !Number.isFinite(entry.at)) continue;
    if (!STATUSES.includes(entry.status)) continue;
    if (typeof entry.options !== "object" || entry.options === null) continue;

    const options = entry.options;
    const music = typeof options.music === "object" && options.music !== null ? options.music : null;
    const details = Array.isArray(entry.details) ? entry.details.filter((d) => typeof d === "string") : [];

    items.push({
      id: entry.id,
      name: trimMax(asString(entry.name), 120) || "Story",
      source: entry.source === "picture" ? "picture" : "video",
      at: entry.at,
      audience: entry.audience === "close" ? "close" : "story",
      highlight: trimMax(asString(entry.highlight), 60),
      status: entry.status,
      note: asString(entry.note),
      details,
      warned: entry.warned === true,
      maybePosted: entry.maybePosted === true,
      createdAt: asNumber(entry.createdAt, 0),
      finishedAt: typeof entry.finishedAt === "number" && Number.isFinite(entry.finishedAt) ? entry.finishedAt : null,
      options: {
        mute: options.mute === true,
        overlay: trimMax(asString(options.overlay), 200),
        overlayAt: asSlot(options.overlayAt, "top"),
        linkUrl: trimMax(asString(options.linkUrl), 200),
        linkLabel: trimMax(asString(options.linkLabel), 60),
        linkAt: asSlot(options.linkAt, "bottom"),
        music: music ? { title: collapse(music.title), artist: collapse(music.artist) } : null,
      },
    });
  }

  return {
    paused: raw.paused === true,
    lastSharedAt: typeof raw.lastSharedAt === "number" && Number.isFinite(raw.lastSharedAt) ? raw.lastSharedAt : null,
    items,
  };
}
