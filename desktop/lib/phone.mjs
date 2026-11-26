// Pure helpers for the Android emulator connection (desktop app only): reading adb's output,
// quoting text for the device's shell, and finding buttons in a dump of the screen.
// The shell side that runs adb is desktop/phoneHost.mjs.

/** Folder on the phone the app's videos go to. It shows up as an album in the gallery. */
export const PHONE_FOLDER = "/sdcard/Movies/NoCapEdit";
export const INSTAGRAM = "com.instagram.android";
/** Instagram's own entry points for a shared video (found with `cmd package query-activities`). */
export const INSTAGRAM_REEL = `${INSTAGRAM}/com.instagram.share.handleractivity.ReelShareHandlerActivity`;
export const INSTAGRAM_STORY = `${INSTAGRAM}/com.instagram.share.handleractivity.StoryShareHandlerActivity`;

/**
 * The first device that is ready, from `adb devices`. Emulators first.
 * @param {string} text
 * @returns {string | null} serial, e.g. "emulator-5554"
 */
export function firstDevice(text) {
  const ready = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(\S+)\s+device\b/);
    if (m) ready.push(m[1]);
  }
  return ready.find((s) => s.startsWith("emulator-")) ?? ready[0] ?? null;
}

/**
 * Screen size from `wm size` ("Physical size: 1080x2424", possibly with an "Override size" line, which wins).
 * @param {string} text
 * @returns {{ width: number, height: number } | null}
 */
export function screenSize(text) {
  const m = text.match(/Override size:\s*(\d+)x(\d+)/) ?? text.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The size to stream the screen at: the long side held to `maxLong`, both sides even (the encoder needs that).
 * @param {{ width: number, height: number }} size
 * @param {number} maxLong
 */
export function streamSize(size, maxLong) {
  const k = Math.min(1, maxLong / Math.max(size.width, size.height));
  const even = (/** @type {number} */ n) => Math.max(2, Math.round((n * k) / 2) * 2);
  return { width: even(size.width), height: even(size.height) };
}

/**
 * A safe file name for the phone: letters, digits, dash, underscore, dot; always ends in .mp4.
 * @param {string} name
 */
export function phoneFileName(name) {
  const base = name.replace(/\.[a-z0-9]{1,5}$/i, "").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${base || "nocap-edit"}.mp4`;
}

/**
 * One argument for the device's shell. `adb shell a b c` joins its arguments with spaces and hands
 * the line to sh on the phone, so anything that is not plainly safe is wrapped in single quotes.
 * @param {string} arg
 */
export function shellQuote(arg) {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** Characters `input text` cannot type are swapped for a plain one where there is an obvious match. */
const PLAIN = new Map([
  ["‘", "'"], ["’", "'"], ["“", '"'], ["”", '"'], ["–", "-"], ["—", "-"], ["…", "..."], [" ", " "],
]);

/**
 * Text as the phone's `input text` can type it: plain ASCII only (it crashes on anything else,
 * measured on Android 16). Returns the lines to type and what had to be left out.
 * @param {string} text
 * @returns {{ lines: string[], dropped: string[] }}
 */
export function typeable(text) {
  /** @type {string[]} */
  const dropped = [];
  let out = "";
  for (const ch of text.replace(/\r\n?/g, "\n")) {
    const plain = PLAIN.get(ch) ?? ch;
    if (plain === "\n" || /^[\x20-\x7e]+$/.test(plain)) out += plain;
    else if (!dropped.includes(ch)) dropped.push(ch);
  }
  return { lines: out.split("\n").map((l) => l.replace(/[ \t]+$/g, "")), dropped };
}

/** `input text` reads "%s" as a space, so spaces are sent that way. */
function inputTextArg(line) {
  return line.replace(/ /g, "%s");
}

/**
 * The pieces to type one line with `input text`, so that a "%s" the user really wrote is not turned into a space.
 * @param {string} line plain ASCII, no line breaks
 * @returns {string[]} one `input text` argument per piece
 */
export function inputTextPieces(line) {
  return line
    .split(/(?<=%)(?=s)/)
    .filter((p) => p !== "")
    .map(inputTextArg);
}

/**
 * @typedef {{ text: string, desc: string, id: string, cls: string, clickable: boolean, x: number, y: number, w: number, h: number }} UiNode
 */

const ENTITIES = new Map([["&amp;", "&"], ["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'], ["&apos;", "'"], ["&#10;", "\n"], ["&#13;", ""]]);
const unescape = (/** @type {string} */ s) => s.replace(/&(?:amp|lt|gt|quot|apos|#10|#13);/g, (m) => ENTITIES.get(m) ?? m);

/**
 * The elements in a `uiautomator dump` of the screen. Elements with no size (off screen) are left out.
 * @param {string} xml
 * @returns {UiNode[]}
 */
export function parseUi(xml) {
  /** @type {UiNode[]} */
  const nodes = [];
  for (const m of xml.matchAll(/<node\b([^>]*)>/g)) {
    const attrs = m[1];
    const get = (/** @type {string} */ name) => unescape(attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "");
    const b = get("bounds").match(/^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/);
    if (!b) continue;
    const [x1, y1, x2, y2] = [Number(b[1]), Number(b[2]), Number(b[3]), Number(b[4])];
    if (x2 <= x1 || y2 <= y1) continue;
    nodes.push({
      text: get("text"),
      desc: get("content-desc"),
      id: get("resource-id").replace(/^.*:id\//, ""),
      cls: get("class").replace(/^.*\./, ""),
      clickable: get("clickable") === "true",
      x: Math.round((x1 + x2) / 2),
      y: Math.round((y1 + y2) / 2),
      w: x2 - x1,
      h: y2 - y1,
    });
  }
  return nodes;
}

/**
 * The first element matching every given field. `text` and `desc` compare without regard to case.
 * @param {UiNode[]} nodes
 * @param {{ id?: string, text?: string, desc?: string }} want
 * @returns {UiNode | null}
 */
export function findUi(nodes, want) {
  const same = (/** @type {string} */ a, /** @type {string} */ b) => a.trim().toLowerCase() === b.trim().toLowerCase();
  return (
    nodes.find(
      (n) => (want.id === undefined || n.id === want.id) && (want.text === undefined || same(n.text, want.text)) && (want.desc === undefined || same(n.desc, want.desc)),
    ) ?? null
  );
}

/**
 * The search result to pick for what the user typed: an exact match of the title if there is one, else the first.
 * @param {UiNode[]} nodes
 * @param {string} rowId resource id of a result's title
 * @param {string} typed
 * @returns {UiNode | null}
 */
export function pickResult(nodes, rowId, typed) {
  const rows = nodes.filter((n) => n.id === rowId && n.text.trim() !== "");
  const t = typed.trim().toLowerCase().replace(/^@/, "");
  return rows.find((n) => n.text.trim().toLowerCase() === t) ?? rows[0] ?? null;
}

/** Where a sticker or a line of text can be put on a Story: a third of the way down, the middle, or low (above the caption line). */
export const STORY_SLOTS = /** @type {const} */ (["top", "middle", "bottom"]);

/**
 * The height on the phone's screen for a slot, in the phone's own pixels.
 * `nudge` moves it a little lower, for a second thing put in the same slot.
 * @param {string} slot one of STORY_SLOTS; anything else is "middle"
 * @param {number} screenHeight
 * @param {boolean} [nudge]
 */
export function storySlotY(slot, screenHeight, nudge = false) {
  const at = slot === "top" ? 0.2 : slot === "bottom" ? 0.68 : 0.455;
  return Math.round(screenHeight * (at + (nudge ? 0.075 : 0)));
}

/**
 * A web address fit to type into Instagram's Link sticker: http or https, plain keyboard characters,
 * no spaces, at most 200 long. "example.com/x" gets "https://" put in front. Null when it is not one.
 * @param {unknown} text
 * @returns {string | null}
 */
export function cleanLinkUrl(text) {
  if (typeof text !== "string") return null;
  let t = text.trim();
  if (!t || t.length > 200 || !/^[\x21-\x7e]+$/.test(t)) return null;
  if (!/^https?:\/\//i.test(t)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) && !/^[^/:]+:\d+(\/|$)/.test(t)) return null; // some other scheme (javascript:, intent: ...)
    t = `https://${t}`;
  }
  try {
    const url = new URL(t);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!url.hostname.includes(".") || url.username || url.password) return null;
  } catch {
    return null;
  }
  return t;
}

/**
 * Whose Story a viewer heading or a tray entry is for, from its description
 * ("someone's story, 10 hours ago" / "someone's story, 0 of 4, Seen."). Null when it is not one.
 * @param {string} desc
 * @returns {string | null}
 */
export function storyOwner(desc) {
  const m = desc.match(/^(.+?)'s story, /);
  return m ? m[1].trim() : null;
}

/**
 * How long ago a Story was posted, in minutes, from the viewer's heading
 * ("…'s story, 54 seconds ago", "… 2 minutes ago", "… 10 hours ago", "… just now"). Null when it does not say.
 * @param {string} desc
 * @returns {number | null}
 */
export function storyAgeMinutes(desc) {
  if (/'s story, just now/i.test(desc)) return 0;
  const m = desc.match(/'s story, (\d+) (second|minute|hour|day|week)s? ago/i);
  if (!m) return null;
  const n = Number(m[1]);
  const per = { second: 1 / 60, minute: 1, hour: 60, day: 1440, week: 10080 }[m[2].toLowerCase()] ?? 1;
  return n * per;
}

/**
 * The Highlight to add to, in Instagram's "Add to highlights" list: the one whose name is exactly
 * `name` (letter case aside). `count` is how many carry that name; more than one means it cannot be told apart.
 * `seen` lists the names on screen, to notice when a sideways scroll brought nothing new.
 * @param {UiNode[]} nodes
 * @param {string} name
 * @returns {{ label: UiNode | null, count: number, seen: string[] }}
 */
export function findHighlight(nodes, name) {
  const header = nodes.find((n) => n.id === "header_text");
  const labels = nodes.filter((n) => n.id === "username" && n.text.trim() !== "" && (!header || n.y > header.y));
  const want = name.trim().toLowerCase();
  const hits = labels.filter((n) => n.text.trim().toLowerCase() === want);
  return { label: hits[0] ?? null, count: hits.length, seen: labels.map((n) => `${n.text.trim()}@${n.x}`) };
}

// ---- Starting the emulator ----

/**
 * The virtual phone names from `emulator -list-avds`. Blank lines and log lines are dropped.
 * @param {string} text
 * @returns {string[]}
 */
export function parseAvdList(text) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const line of text.split("\n")) {
    const name = line.trim();
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Which virtual phone to start: the one asked for if it exists, else the remembered one if it exists,
 * else the first available. Null when there are none.
 * @param {string[]} avds
 * @param {string | null | undefined} asked
 * @param {string | null | undefined} remembered
 * @returns {string | null}
 */
export function pickAvd(avds, asked, remembered) {
  if (asked && avds.includes(asked)) return asked;
  if (remembered && avds.includes(remembered)) return remembered;
  return avds[0] ?? null;
}

/**
 * The emulator's state from `adb devices`. Real phones are ignored.
 * @param {string} text
 * @returns {{ serial: string | null, state: "ready" | "starting" | "none" }}
 */
export function emulatorStatus(text) {
  /** @type {string | null} */
  let readySerial = null;
  /** @type {string | null} */
  let firstEmulator = null;
  for (const line of text.split("\n")) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    if (!/^emulator-\d+$/.test(parts[0])) continue;
    if (firstEmulator === null) firstEmulator = parts[0];
    if (parts[1] === "device" && readySerial === null) readySerial = parts[0];
  }
  if (readySerial !== null) return { serial: readySerial, state: "ready" };
  if (firstEmulator !== null) return { serial: firstEmulator, state: "starting" };
  return { serial: null, state: "none" };
}

/**
 * One plain line saying why the emulator closed right after it was started, from its log text.
 * @param {string} log
 * @returns {string}
 */
export function launchFailure(log) {
  const lines = log.split("\n").map((l) => l.trim()).filter((l) => l !== "");
  let chosen = null;
  for (const line of lines) {
    if (line.startsWith("ERROR") || line.startsWith("FATAL")) chosen = line;
  }
  if (chosen === null && lines.length > 0) chosen = lines[lines.length - 1];
  if (chosen === null) return "The emulator closed right after it was started.";
  // The one people actually meet: the phone is already open in another emulator window.
  if (/multiple emulators with the same AVD/i.test(chosen)) return "That phone is already open in another emulator window.";
  const cleaned = chosen.replace(/^(ERROR|FATAL|WARNING|INFO)\s*\|\s*/, "");
  if (cleaned === "") return "The emulator closed right after it was started.";
  return cleaned.slice(0, 200);
}

/**
 * The system image a virtual phone runs, from its config.ini (`image.sysdir.1=system-images/android-36/...`):
 * a folder inside the Android SDK. It tells which SDK on this Mac can start that phone.
 * @param {string} config
 * @returns {string | null}
 */
export function avdImageDir(config) {
  const m = config.match(/^\s*image\.sysdir\.1\s*=\s*(.+?)\s*$/m);
  if (!m) return null;
  const dir = m[1].replace(/\\/g, "/").replace(/\/+$/, "");
  // Only a plain folder inside the SDK: nothing absolute, nothing that climbs out.
  return dir && !dir.startsWith("/") && !dir.split("/").includes("..") ? dir : null;
}

// ---- Highlight cover ----

/**
 * Minutes since epoch from "2026-11-25 23:27" (surrounding whitespace allowed).
 * @param {string} text
 * @returns {number | null}
 */
export function wallMinutes(text) {
  if (typeof text !== "string") return null;
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  return Date.UTC(year, month, day, hour, minute) / 60000;
}

const MONTHS = {
  January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
  July: 6, August: 7, September: 8, October: 9, November: 10, December: 11,
};

/**
 * Minutes since epoch from a gallery thumbnail label like
 * "Selected Photo thumbnail created on November 24, 2026 9:56 AM".
 * Spaces may be ordinary, U+00A0, or U+202F.
 * @param {string} desc
 * @returns {number | null}
 */
export function thumbnailMinutes(desc) {
  if (typeof desc !== "string") return null;
  // \s in JS matches space, \t, \n, \r, \f, \v, \u00a0, \u202f, etc.
  const m = desc.match(/created on ([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!m) return null;
  const monthName = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
  const month = MONTHS[monthName];
  if (month === undefined) return null;
  const day = Number(m[2]);
  const year = Number(m[3]);
  let hour = Number(m[4]);
  const minute = Number(m[5]);
  const ampm = m[6].toUpperCase();
  if (ampm === "AM") {
    if (hour === 12) hour = 0;
  } else {
    if (hour !== 12) hour += 12;
  }
  return Date.UTC(year, month, day, hour, minute) / 60000;
}

// ---- Holding the screen still ----

/** Android's three animation speeds. At 0 the screen holds still long enough to be read. */
export const ANIMATION_KEYS = /** @type {const} */ (["animator_duration_scale", "transition_animation_scale", "window_animation_scale"]);

/**
 * The `settings` command that puts one animation speed back to what `settings get` answered before:
 * "null" (never set) is deleted again, a number is written, anything else becomes the normal 1.0.
 * @param {string} key
 * @param {string} before
 * @returns {string[]}
 */
export function restoreSetting(key, before) {
  const value = String(before ?? "").trim();
  if (value === "null") return ["settings", "delete", "global", key];
  return ["settings", "put", "global", key, /^\d+(\.\d+)?$/.test(value) ? value : "1.0"];
}
