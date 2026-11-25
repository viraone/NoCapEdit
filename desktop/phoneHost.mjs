// The Android emulator, for the page (desktop app only).
//
// The page can: ask whether an emulator is running, send it a finished video, watch its screen,
// tap and type on it, and have Instagram opened on that video and walked through the Reel steps.
// Everything goes through `adb`, the Android tool already on this Mac; the page never runs a
// command of its own, it only picks from the fixed list below (desktop/preload.cjs).
//
// Sharing is its own call ("phone:share"), made only when the page asks for it.
import { app, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppUrl } from "./lib/appUrl.mjs";
import {
  cleanLinkUrl,
  findUi,
  firstDevice,
  inputTextPieces,
  INSTAGRAM,
  INSTAGRAM_REEL,
  INSTAGRAM_STORY,
  parseUi,
  PHONE_FOLDER,
  phoneFileName,
  pickResult,
  screenSize,
  shellQuote,
  STORY_SLOTS,
  storySlotY,
  streamSize,
  typeable,
} from "./lib/phone.mjs";

const MEDIA_URI = /^content:\/\/media\/external\/video\/media\/\d+$/;
/** Keys the page may press: Home, Back, Enter, Delete, Tab, arrows, app switcher. */
const KEYS = new Set([3, 4, 66, 67, 61, 19, 20, 21, 22, 187]);
/** Longest side of the streamed picture, in pixels. */
const STREAM_LONG_SIDE = 1212;

/** @type {string | null | undefined} */
let adbPath;

function adbCandidates() {
  return [
    process.env.NOCAP_ADB,
    "/opt/homebrew/share/android-commandlinetools/platform-tools/adb",
    path.join(os.homedir(), "Library/Android/sdk/platform-tools/adb"),
    "/opt/homebrew/bin/adb",
    "/usr/local/bin/adb",
  ].filter((p) => typeof p === "string" && p !== "");
}

async function findAdb() {
  if (adbPath !== undefined) return adbPath;
  adbPath = null;
  if (process.env.NOCAP_ADB === "off") return adbPath;
  for (const file of adbCandidates()) {
    try {
      await fsp.access(/** @type {string} */ (file), fs.constants.X_OK);
      adbPath = /** @type {string} */ (file);
      break;
    } catch {
      // not here; try the next place
    }
  }
  return adbPath;
}

/**
 * Runs adb and returns what it printed. Rejects when adb is missing, fails or takes too long.
 * @param {string[]} args
 * @param {{ timeout?: number, serial?: string | null }} [opts]
 * @returns {Promise<string>}
 */
async function adb(args, opts = {}) {
  const file = await findAdb();
  if (!file) throw new Error("adb was not found on this Mac.");
  const full = opts.serial ? ["-s", opts.serial, ...args] : args;
  return new Promise((resolve, reject) => {
    execFile(file, full, { timeout: opts.timeout ?? 20_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(String(stderr || err.message).trim().slice(0, 300)));
      else resolve(String(stdout));
    });
  });
}

/** `adb shell` with each argument quoted for the phone's own shell. */
function sh(/** @type {string | null} */ serial, /** @type {string[]} */ args, timeout = 20_000) {
  return adb(["shell", args.map(shellQuote).join(" ")], { serial, timeout });
}

const wait = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

async function device() {
  try {
    return firstDevice(await adb(["devices"], { timeout: 6000 }));
  } catch {
    return null;
  }
}

async function requireDevice() {
  const serial = await device();
  if (!serial) throw new Error("The Android emulator is not running.");
  return serial;
}

async function phoneInfo() {
  if (!(await findAdb())) return { available: false, reason: "The Android tool (adb) is not installed on this Mac." };
  const serial = await device();
  if (!serial) return { available: false, reason: "Start the Android emulator first." };
  let size = null;
  let instagram = false;
  try {
    size = screenSize(await sh(serial, ["wm", "size"], 6000));
    instagram = (await sh(serial, ["pm", "list", "packages", INSTAGRAM], 8000)).includes(`package:${INSTAGRAM}`);
  } catch {
    // answered once already, so it is there; the details are optional
  }
  return { available: true, device: serial, width: size?.width ?? 1080, height: size?.height ?? 1920, instagram };
}

// ---- Sending a video ------------------------------------------------------------------------

/** @type {Map<string, { file: string, sender: import("electron").WebContents }>} */
const uploads = new Map();
let nextUpload = 1;

function uploadRoot() {
  return path.join(fs.realpathSync(app.getPath("temp")), "nocap-edit-phone");
}

/**
 * Copies an uploaded file to the phone's gallery and returns its gallery address.
 * @param {string} file @param {string} name
 */
async function pushToPhone(file, name) {
  const serial = await requireDevice();
  const remote = `${PHONE_FOLDER}/${phoneFileName(name)}`;
  await sh(serial, ["mkdir", "-p", PHONE_FOLDER]);
  await adb(["push", file, remote], { serial, timeout: 10 * 60_000 });
  // Tells the gallery about the file right away; it answers with the file's gallery address.
  await sh(serial, ["content", "call", "--uri", "content://media", "--method", "scan_file", "--arg", remote], 30_000);
  const rows = await sh(serial, ["content", "query", "--uri", "content://media/external/video/media", "--projection", "_id", "--where", `_data LIKE '%/${phoneFileName(name)}'`], 15_000);
  const ids = [...rows.matchAll(/_id=(\d+)/g)].map((m) => Number(m[1]));
  if (!ids.length) throw new Error("The video reached the phone but the gallery did not list it.");
  return { path: remote, uri: `content://media/external/video/media/${Math.max(...ids)}` };
}

// ---- Watching the screen --------------------------------------------------------------------

/** @type {{ child: import("node:child_process").ChildProcess | null, sender: import("electron").WebContents, wanted: boolean } | null} */
let screen = null;

async function startScreen(/** @type {import("electron").WebContents} */ sender) {
  stopScreen();
  const serial = await requireDevice();
  const file = /** @type {string} */ (await findAdb());
  const size = streamSize(screenSize(await sh(serial, ["wm", "size"], 6000)) ?? { width: 1080, height: 1920 }, STREAM_LONG_SIDE);
  const state = { child: /** @type {import("node:child_process").ChildProcess | null} */ (null), sender, wanted: true };
  screen = state;
  const run = () => {
    if (!state.wanted || sender.isDestroyed()) return;
    // The phone's own screen recorder, writing raw H.264 to adb's output. It stops by itself after
    // three minutes at most, so it is started again each time it ends.
    const child = spawn(file, ["-s", serial, "exec-out", "screenrecord", "--output-format=h264", "--bit-rate", "6000000", "--size", `${size.width}x${size.height}`, "--time-limit", "170", "-"], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    state.child = child;
    const started = Date.now();
    child.stdout.on("data", (chunk) => {
      if (state.wanted && !sender.isDestroyed()) sender.send("phone:video", chunk);
    });
    child.on("close", () => {
      state.child = null;
      if (!state.wanted || sender.isDestroyed()) return;
      sender.send("phone:video", null); // a new stream follows: the page starts its decoder afresh
      setTimeout(run, Date.now() - started < 2000 ? 1500 : 100);
    });
  };
  run();
  return size;
}

function stopScreen() {
  if (!screen) return;
  screen.wanted = false;
  screen.child?.kill("SIGKILL");
  screen = null;
}

// ---- Touch and typing -----------------------------------------------------------------------

const whole = (/** @type {unknown} */ n, max = 10_000) => (typeof n === "number" && Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : null);

/** Types text into whatever has the cursor. Returns the characters it could not type. */
async function typeText(/** @type {string} */ serial, /** @type {string} */ text) {
  const { lines, dropped } = typeable(text.slice(0, 2500));
  for (let i = 0; i < lines.length; i++) {
    for (const piece of inputTextPieces(lines[i])) await sh(serial, ["input", "text", piece], 30_000);
    if (i < lines.length - 1) await sh(serial, ["input", "keyevent", "66"]);
  }
  return dropped;
}

/** @param {unknown} action */
async function phoneInput(action) {
  const serial = await requireDevice();
  const a = /** @type {Record<string, unknown>} */ (action && typeof action === "object" ? action : {});
  if (a.kind === "tap") {
    const [x, y] = [whole(a.x), whole(a.y)];
    if (x === null || y === null) throw new Error("bad tap");
    await sh(serial, ["input", "tap", String(x), String(y)]);
  } else if (a.kind === "swipe") {
    const [x1, y1, x2, y2] = [whole(a.x1), whole(a.y1), whole(a.x2), whole(a.y2)];
    const ms = whole(a.ms, 3000) ?? 200;
    if (x1 === null || y1 === null || x2 === null || y2 === null) throw new Error("bad swipe");
    await sh(serial, ["input", "swipe", String(x1), String(y1), String(x2), String(y2), String(Math.max(60, ms))]);
  } else if (a.kind === "key") {
    if (typeof a.code !== "number" || !KEYS.has(a.code)) throw new Error("bad key");
    await sh(serial, ["input", "keyevent", String(a.code)]);
  } else if (a.kind === "text") {
    if (typeof a.text !== "string") throw new Error("bad text");
    return { dropped: await typeText(serial, a.text) };
  } else {
    throw new Error("bad input");
  }
  return {};
}

// ---- Instagram ------------------------------------------------------------------------------

/** What is on the phone's screen right now. Tried a few times: a playing video can make the dump fail. */
async function look(/** @type {string} */ serial) {
  for (let i = 0; i < 4; i++) {
    try {
      const xml = await adb(["shell", "uiautomator dump /sdcard/nocap-ui.xml >/dev/null 2>&1; cat /sdcard/nocap-ui.xml"], { serial, timeout: 20_000 });
      if (xml.includes("<hierarchy")) return parseUi(xml);
    } catch {
      // try again
    }
    await wait(700);
  }
  return [];
}

/**
 * Waits until an element shows up, closing Instagram's own pop-up sheets on the way.
 * @param {string} serial
 * @param {{ id?: string, text?: string, desc?: string }} want
 * @param {number} [ms]
 */
async function waitFor(serial, want, ms = 20_000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const nodes = await look(serial);
    const hit = findUi(nodes, want);
    if (hit) return { hit, nodes };
    // Android's own "fill in your address" suggestion hides everything else from the dump; Escape closes it.
    if (nodes.length > 0 && nodes.length <= 4 && nodes.some((n) => n.id === "text1")) await sh(serial, ["input", "keyevent", "111"]);
    const sheet = findUi(nodes, { desc: "Close sheet" });
    if (sheet) await sh(serial, ["input", "tap", String(sheet.x), String(sheet.y)]);
    // A one-time notice ("Your text and stickers will be translated" and the like): its only job is to be read.
    const notice = findUi(nodes, { id: "igds_headline_headline" }) && findUi(nodes, { id: "primary_button", text: "OK" });
    if (notice) await sh(serial, ["input", "tap", String(notice.x), String(notice.y)]);
    await wait(600);
  }
  return null;
}

const tap = (/** @type {string} */ serial, /** @type {{ x: number, y: number }} */ n) => sh(serial, ["input", "tap", String(n.x), String(n.y)]);

/** Hands a video in the phone's gallery to Instagram's Reel or Story screen. */
async function openInstagram(/** @type {string} */ serial, /** @type {"reel" | "story"} */ mode, /** @type {string} */ uri) {
  if (!MEDIA_URI.test(uri)) throw new Error("bad video address");
  // A handoff to an Instagram that is not running yet lands on its home feed, so it is started first.
  const running = (await sh(serial, ["pidof", INSTAGRAM]).catch(() => "")).trim() !== "";
  if (!running) {
    await sh(serial, ["monkey", "-p", INSTAGRAM, "-c", "android.intent.category.LAUNCHER", "1"], 30_000);
    await wait(7000);
  }
  await sh(serial, [
    "am", "start", "-a", "android.intent.action.SEND", "-t", "video/mp4", "--eu", "android.intent.extra.STREAM", uri,
    "--grant-read-uri-permission", "-n", mode === "story" ? INSTAGRAM_STORY : INSTAGRAM_REEL,
  ]);
}

/**
 * Shows Instagram's own home feed, if that can be done without losing anything: Instagram is brought
 * to the front, and its Home tab is tapped when it is on screen. With an editor or a draft open the
 * tab is not there; nothing is pressed then, so no draft is ever discarded from here.
 * @returns {Promise<{ state: "home" | "busy" }>}
 */
async function instagramHome() {
  const serial = await requireDevice();
  const focus = await sh(serial, ["dumpsys", "window"], 15_000).catch(() => "");
  const inFront = (focus.match(/mCurrentFocus=.*/)?.[0] ?? "").includes(`${INSTAGRAM}/`);
  if (!inFront) {
    const running = (await sh(serial, ["pidof", INSTAGRAM]).catch(() => "")).trim() !== "";
    await sh(serial, ["monkey", "-p", INSTAGRAM, "-c", "android.intent.category.LAUNCHER", "1"], 30_000);
    await wait(running ? 1500 : 7000);
  }
  for (let i = 0; i < 2; i++) {
    const tab = findUi(await look(serial), { id: "feed_tab" });
    if (tab) {
      await tap(serial, tab);
      return { state: "home" };
    }
    await wait(700);
  }
  return { state: "busy" };
}

/** @type {{ cancelled: boolean } | null} */
let job = null;

class Stopped extends Error {}

/**
 * Walks Instagram through the Reel steps the user ticked, up to but not including Share.
 * @param {import("electron").WebContents} sender
 * @param {string} uri
 * @param {Record<string, unknown>} raw
 */
async function runReel(sender, uri, raw) {
  const serial = await requireDevice();
  const o = {
    keepFull: raw.keepFull !== false,
    next: raw.next !== false,
    overlay: typeof raw.overlay === "string" ? raw.overlay.trim().slice(0, 200) : "",
    caption: typeof raw.caption === "string" ? raw.caption.trim().slice(0, 2200) : "",
    location: typeof raw.location === "string" ? raw.location.trim().slice(0, 80) : "",
    people: Array.isArray(raw.people) ? raw.people.filter((p) => typeof p === "string").map((p) => p.trim().replace(/^@/, "")).filter((p) => /^[A-Za-z0-9._]{1,30}$/.test(p)).slice(0, 10) : [],
  };
  const mine = { cancelled: false };
  job = mine;
  /** @type {string[]} */
  const notes = [];
  const step = async (/** @type {string} */ label, /** @type {() => Promise<void>} */ fn) => {
    if (mine.cancelled) throw new Stopped("Stopped.");
    if (!sender.isDestroyed()) sender.send("phone:step", label);
    await fn();
  };
  const need = async (/** @type {{ id?: string, text?: string, desc?: string }} */ want, /** @type {string} */ what, ms = 20_000) => {
    const found = await waitFor(serial, want, ms);
    if (!found) throw new Error(`Instagram did not show ${what}. Finish in the phone panel.`);
    return found;
  };
  const shareScreen = () => need({ id: "caption_input_text_view" }, "the caption screen");

  try {
    await step("Opening Instagram", async () => {
      await openInstagram(serial, "reel", uri);
      await need({ id: "clips_right_action_button" }, "the Reel editor", 40_000);
    });

    if (!o.keepFull) {
      await step("Opening the trim tools", async () => {
        const { hit } = await need({ id: "clips_left_action_button" }, "the Edit video button");
        await tap(serial, hit);
      });
      return { ready: false, stoppedAt: "trim", notes };
    }

    if (o.overlay) {
      await step("Adding the text", async () => {
        const { hit } = await need({ id: "clips_action_bar_add_text_button" }, "the Text button");
        await tap(serial, hit);
        await need({ id: "text_composer_edit_text" }, "the text box");
        const dropped = await typeText(serial, o.overlay);
        if (dropped.length) notes.push(`Left out of the text (the phone cannot type them): ${dropped.join(" ")}`);
        const done = await need({ id: "done_button" }, "the Done button");
        await tap(serial, done.hit);
        await need({ id: "clips_right_action_button" }, "the Reel editor");
      });
    }

    if (!o.next) return { ready: false, stoppedAt: "editor", notes };

    await step("Going to the caption screen", async () => {
      const { hit } = await need({ id: "clips_right_action_button" }, "the Next button");
      await tap(serial, hit);
      await shareScreen();
    });

    if (o.caption) {
      await step("Writing the caption", async () => {
        const { hit } = await shareScreen();
        await tap(serial, hit);
        await wait(900);
        const dropped = await typeText(serial, o.caption);
        if (dropped.length) notes.push(`Left out of the caption (the phone cannot type them): ${dropped.join(" ")}`);
        // The tick at the top right closes the keyboard and keeps the caption.
        const nodes = await look(serial);
        const done = findUi(nodes, { desc: "Done" });
        if (done) await tap(serial, done);
        else await sh(serial, ["input", "keyevent", "4"]);
        await shareScreen();
      });
    }

    if (o.location) {
      await step("Adding the location", async () => {
        const { hit } = await need({ text: "Add location" }, "Add location");
        await tap(serial, hit);
        const box = await need({ id: "row_search_edit_text" }, "the location search");
        const clear = findUi(box.nodes, { desc: "Clear text" });
        if (clear) await tap(serial, clear);
        else await tap(serial, box.hit);
        await wait(500);
        await typeText(serial, o.location);
        await wait(3500);
        const row = pickResult(await look(serial), "row_venue_title", o.location);
        if (!row) {
          notes.push(`No place found for "${o.location}".`);
          await sh(serial, ["input", "keyevent", "4"]);
          await wait(600);
          if (!(await waitFor(serial, { id: "caption_input_text_view" }, 3000))) await sh(serial, ["input", "keyevent", "4"]);
        } else {
          notes.push(`Location: ${row.text}`);
          await tap(serial, row);
        }
        await shareScreen();
      });
    }

    if (o.people.length) {
      await step("Tagging people", async () => {
        const { hit } = await need({ text: "Tag people" }, "Tag people");
        await tap(serial, hit);
        for (const person of o.people) {
          if (mine.cancelled) throw new Stopped("Stopped.");
          const add = await need({ id: "add_people_tag_button" }, "the Add tag button");
          await tap(serial, add.hit);
          await need({ id: "search_edit_text" }, "the people search");
          await typeText(serial, person);
          await wait(3500);
          // Only an exact match of the username is tagged; a near miss would tag a stranger.
          const row = (await look(serial)).find((n) => n.id === "row_search_user_username" && n.text.trim().toLowerCase() === person.toLowerCase());
          if (row) {
            await tap(serial, row);
            notes.push(`Tagged @${person}`);
          } else {
            notes.push(`No account named exactly @${person}; not tagged.`);
            await sh(serial, ["input", "keyevent", "4"]);
            await wait(600);
            if (!(await waitFor(serial, { id: "add_people_tag_button" }, 3000))) await sh(serial, ["input", "keyevent", "4"]);
          }
        }
        const done = await need({ id: "clips_people_tagging_done_button" }, "the Done button");
        await tap(serial, done.hit);
        await shareScreen();
      });
    }

    return { ready: true, notes };
  } catch (err) {
    if (err instanceof Stopped) return { ready: false, stoppedAt: "cancelled", notes };
    return { ready: false, stoppedAt: "failed", error: err instanceof Error ? err.message : String(err), notes };
  } finally {
    if (job === mine) job = null;
  }
}

// ---- Story ------------------------------------------------------------------------------------

/**
 * Types into the field with this id and checks what landed there: typed too soon after a tap, the
 * first letters can be lost while the keyboard opens. One retry; returns false when it still differs.
 * @param {string} serial @param {string} fieldId @param {string} text plain keyboard characters
 */
async function typeChecked(serial, fieldId, text) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const field = findUi(await look(serial), { id: fieldId });
    if (!field) return false;
    await tap(serial, field);
    await wait(1400);
    if (field.text && attempt > 0) await sh(serial, ["input", "keyevent", ...Array(Math.min(250, field.text.length + 4)).fill("67")], 30_000);
    await typeText(serial, text);
    await wait(700);
    const now = findUi(await look(serial), { id: fieldId });
    if (now && now.text.trim() === text.trim()) return true;
  }
  return false;
}

/**
 * Drags a sticker (or a line of text) on the Story to a height on the screen. A drag lands a little
 * short of where it was aimed, so it is corrected once.
 * @param {string} serial
 * @param {(n: import("./lib/phone.mjs").UiNode) => boolean} which
 * @param {number} targetY
 */
async function dragSticker(serial, which, targetY) {
  for (let i = 0; i < 2; i++) {
    const node = (await look(serial)).find(which);
    if (!node) return false;
    if (Math.abs(node.y - targetY) < 50) return true;
    await sh(serial, ["input", "swipe", String(node.x), String(node.y), String(node.x), String(targetY), "900"]);
    await wait(900);
  }
  return true;
}

const isLinkSticker = (/** @type {import("./lib/phone.mjs").UiNode} */ n) => n.desc.startsWith("Sticker. Touch and hold");
const isTextSticker = (/** @type {import("./lib/phone.mjs").UiNode} */ n) => n.desc.includes(", Sticker. Touch and hold");

/**
 * Walks Instagram's Story screen through what the user ticked, up to but not including sharing.
 * @param {import("electron").WebContents} sender
 * @param {string} uri
 * @param {Record<string, unknown>} raw
 */
async function runStory(sender, uri, raw) {
  const serial = await requireDevice();
  const slot = (/** @type {unknown} */ v) => (typeof v === "string" && /** @type {readonly string[]} */ (STORY_SLOTS).includes(v) ? v : "middle");
  const o = {
    mute: raw.mute === true,
    overlay: typeof raw.overlay === "string" ? typeable(raw.overlay.trim().slice(0, 200)).lines.join(" ").trim() : "",
    overlayAt: slot(raw.overlayAt),
    linkUrl: cleanLinkUrl(raw.linkUrl),
    linkLabel: typeof raw.linkLabel === "string" ? typeable(raw.linkLabel.trim().slice(0, 60)).lines.join(" ").trim() : "",
    linkAt: slot(raw.linkAt),
  };
  const mine = { cancelled: false };
  job = mine;
  /** @type {string[]} */
  const notes = [];
  if (typeof raw.linkUrl === "string" && raw.linkUrl.trim() && !o.linkUrl) notes.push("The link is not a web address the phone can type, so no link sticker was added.");
  const step = async (/** @type {string} */ label, /** @type {() => Promise<void>} */ fn) => {
    if (mine.cancelled) throw new Stopped("Stopped.");
    if (!sender.isDestroyed()) sender.send("phone:step", label);
    await fn();
  };
  const need = async (/** @type {{ id?: string, text?: string, desc?: string }} */ want, /** @type {string} */ what, ms = 20_000) => {
    const found = await waitFor(serial, want, ms);
    if (!found) throw new Error(`Instagram did not show ${what}. Finish in the phone panel.`);
    return found;
  };
  const editor = () => need({ id: "your_story_share_shortcut_button" }, "the Story screen");

  try {
    const height = screenSize(await sh(serial, ["wm", "size"], 6000))?.height ?? 2424;

    await step("Opening Instagram", async () => {
      await openInstagram(serial, "story", uri);
      await need({ id: "your_story_share_shortcut_button" }, "the Story screen", 40_000);
    });

    if (o.mute) {
      await step("Muting the video's sound", async () => {
        const { nodes } = await editor();
        const off = findUi(nodes, { desc: "Mute volume" });
        if (off) await tap(serial, off);
        else if (!findUi(nodes, { desc: "Unmute volume" })) notes.push("The mute button was not found; the sound was left as it is.");
      });
    }

    // The link goes on first and is moved out of the centre before the text arrives there, so the two never sit on top of each other.
    if (o.linkUrl) {
      await step("Adding the link sticker", async () => {
        const { nodes } = await editor();
        const tray = findUi(nodes, { id: "asset_button" });
        if (!tray) throw new Error("Instagram did not show the Stickers button. Finish in the phone panel.");
        await tap(serial, tray);
        const link = await need({ desc: "Link Sticker" }, "the Link sticker");
        await tap(serial, link.hit);
        await need({ id: "link_sticker_list_web_url_edit_text" }, "the link's address box");
        if (!(await typeChecked(serial, "link_sticker_list_web_url_edit_text", /** @type {string} */ (o.linkUrl)))) {
          throw new Error("The link's address did not type correctly. Fix it in the phone panel.");
        }
        if (o.linkLabel) {
          const now = await look(serial);
          if (!findUi(now, { id: "link_sticker_custom_cta_edit_text" })) {
            const row = findUi(now, { id: "link_sticker_custom_cta_row" });
            if (row) await tap(serial, row);
            await need({ id: "link_sticker_custom_cta_edit_text" }, "the sticker text box");
          }
          if (!(await typeChecked(serial, "link_sticker_custom_cta_edit_text", o.linkLabel))) notes.push("The sticker's text did not type correctly; check it in the phone panel.");
        }
        const done = findUi(await look(serial), { id: "link_sticker_list_done_icon_button" });
        if (!done) throw new Error("Instagram did not show the link's Done button. Finish in the phone panel.");
        await tap(serial, done);
        await editor();
        await dragSticker(serial, isLinkSticker, storySlotY(o.linkAt, height, o.overlay !== "" && o.overlayAt === o.linkAt));
        notes.push(`Link sticker: ${o.linkUrl}`);
      });
    }

    if (o.overlay) {
      await step("Adding the text", async () => {
        const { nodes } = await editor();
        const button = findUi(nodes, { id: "add_text_button" });
        if (!button) throw new Error("Instagram did not show the Text button. Finish in the phone panel.");
        await tap(serial, button);
        await need({ id: "text_overlay_edit_text" }, "the text box");
        await wait(900);
        await typeText(serial, o.overlay);
        const done = await need({ id: "done_button" }, "the Done button");
        await tap(serial, done.hit);
        await editor();
        await dragSticker(serial, isTextSticker, storySlotY(o.overlayAt, height));
      });
    }

    await editor();
    return { ready: true, notes };
  } catch (err) {
    if (err instanceof Stopped) return { ready: false, stoppedAt: "cancelled", notes };
    return { ready: false, stoppedAt: "failed", error: err instanceof Error ? err.message : String(err), notes };
  } finally {
    if (job === mine) job = null;
  }
}

/** Shares the Story that is open. Only ever called when the page asks, after its own countdown. */
async function shareStory(/** @type {unknown} */ audience) {
  const serial = await requireDevice();
  const id = audience === "close" ? "close_friends_story_share_shortcut_button" : "your_story_share_shortcut_button";
  const found = await waitFor(serial, { id }, 8000);
  if (!found) throw new Error("Instagram's share button is not on screen. Finish in the phone panel.");
  await tap(serial, found.hit);
  for (let i = 0; i < 6; i++) {
    await wait(1200);
    if (!findUi(await look(serial), { id: "your_story_share_shortcut_button" })) return { shared: true };
  }
  return { shared: false };
}

/** Taps Instagram's Share. Only ever called when the page asks, after its own countdown. */
async function shareReel() {
  const serial = await requireDevice();
  const first = await waitFor(serial, { id: "share_button" }, 8000);
  if (!first) throw new Error("Instagram's Share button is not on screen. Finish in the phone panel.");
  await tap(serial, first.hit);
  // The first time, Instagram puts up a notice about original audio with its own Share button.
  for (let i = 0; i < 6; i++) {
    await wait(1200);
    const nodes = await look(serial);
    const sheetShare = nodes.find((n) => n.text.trim() === "Share" && n.y > 0 && nodes.some((s) => s.id.startsWith("clips_original_audio_nux_sheet")));
    if (sheetShare) {
      await tap(serial, sheetShare);
      continue;
    }
    if (!findUi(nodes, { id: "caption_input_text_view" })) return { shared: true };
  }
  return { shared: false };
}

// ---- The fixed list the page can call --------------------------------------------------------

export function registerPhone() {
  fs.rmSync(uploadRoot(), { recursive: true, force: true });
  app.on("will-quit", () => {
    stopScreen();
    fs.rmSync(uploadRoot(), { recursive: true, force: true });
  });

  /** @param {string} channel @param {(event: import("electron").IpcMainInvokeEvent, ...args: any[]) => unknown} fn */
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) throw new Error("not allowed");
      return fn(event, ...args);
    });

  handle("phone:info", () => phoneInfo());

  handle("phone:begin", async (event) => {
    const id = `u${nextUpload++}`;
    await fsp.mkdir(uploadRoot(), { recursive: true });
    const file = path.join(uploadRoot(), `${id}.mp4`);
    await fsp.writeFile(file, new Uint8Array(0));
    uploads.set(id, { file, sender: event.sender });
    return id;
  });
  handle("phone:write", async (event, id, data) => {
    const up = uploads.get(String(id));
    if (!up || up.sender !== event.sender) throw new Error("no such upload");
    if (!(data instanceof Uint8Array)) throw new Error("bad data");
    await fsp.appendFile(up.file, data);
  });
  handle("phone:send", async (event, id, name) => {
    const up = uploads.get(String(id));
    if (!up || up.sender !== event.sender) throw new Error("no such upload");
    try {
      return await pushToPhone(up.file, typeof name === "string" ? name : "nocap-edit");
    } finally {
      uploads.delete(String(id));
      await fsp.rm(up.file, { force: true });
    }
  });

  handle("phone:screen", async (event, on) => {
    if (on) return startScreen(event.sender);
    stopScreen();
    return null;
  });
  handle("phone:input", (_event, action) => phoneInput(action));

  handle("phone:open", async (_event, mode, uri) => {
    const serial = await requireDevice();
    await openInstagram(serial, mode === "story" ? "story" : "reel", String(uri));
  });
  handle("phone:instagramHome", () => instagramHome());
  handle("phone:reel", (event, uri, options) => runReel(event.sender, String(uri), options && typeof options === "object" ? options : {}));
  handle("phone:story", (event, uri, options) => runStory(event.sender, String(uri), options && typeof options === "object" ? options : {}));
  handle("phone:shareStory", (_event, audience) => shareStory(audience));
  handle("phone:cancel", () => {
    if (job) job.cancelled = true;
  });
  handle("phone:share", () => shareReel());
}
