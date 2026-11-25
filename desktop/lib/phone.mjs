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
