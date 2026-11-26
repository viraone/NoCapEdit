// The Android emulator, for the page (desktop app only).
//
// The page can: ask whether an emulator is running, send it a finished video, watch its screen,
// tap and type on it, and have Instagram opened on that video and walked through the Reel steps.
// Everything goes through `adb`, the Android tool already on this Mac; the page never runs a
// command of its own, it only picks from the fixed list below (desktop/preload.cjs).
//
// Sharing is its own call ("phone:share"), made only when the page asks for it.
import { app, ipcMain } from "electron";
import { execFile, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppUrl } from "./lib/appUrl.mjs";
import {
  ANIMATION_KEYS,
  avdImageDir,
  cleanLinkUrl,
  emulatorStatus,
  findHighlight,
  findUi,
  firstDevice,
  inputTextPieces,
  INSTAGRAM,
  INSTAGRAM_REEL,
  INSTAGRAM_STORY,
  launchFailure,
  parseAvdList,
  parseUi,
  PHONE_FOLDER,
  phoneFileName,
  pickAvd,
  pickResult,
  restoreSetting,
  screenSize,
  shellQuote,
  storyAgeMinutes,
  storyOwner,
  STORY_SLOTS,
  storySlotY,
  streamSize,
  thumbnailMinutes,
  typeable,
  wallMinutes,
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

// ---- Starting the emulator ------------------------------------------------------------------

/** How long a started emulator may take to show up before it counts as not running. */
const LAUNCH_WAIT_MS = 5 * 60_000;

/** @type {string[] | undefined} */
let emulatorPaths;

/**
 * Every emulator program on this Mac. There can be two (Android Studio's SDK and the command-line
 * tools'), each with its own system images, so a virtual phone made with one only starts from that one.
 */
async function findEmulators() {
  if (emulatorPaths !== undefined) return emulatorPaths;
  emulatorPaths = [];
  if (process.env.NOCAP_EMULATOR === "off") return emulatorPaths;
  const places = [process.env.NOCAP_EMULATOR, path.join(os.homedir(), "Library/Android/sdk/emulator/emulator"), "/opt/homebrew/share/android-commandlinetools/emulator/emulator"];
  for (const file of places) {
    if (typeof file !== "string" || file === "" || emulatorPaths.includes(file)) continue;
    try {
      await fsp.access(file, fs.constants.X_OK);
      emulatorPaths.push(file);
    } catch {
      // not here; try the next place
    }
  }
  return emulatorPaths;
}

const findEmulator = async () => (await findEmulators())[0] ?? null;

/**
 * The emulator program that can start this virtual phone: the one whose SDK holds the phone's
 * system image. Falls back to the first program found.
 * @param {string} avd
 * @returns {Promise<{ file: string, sdk: string | null } | null>}
 */
async function emulatorFor(avd) {
  const all = await findEmulators();
  if (all.length === 0) return null;
  try {
    const home = process.env.ANDROID_AVD_HOME || path.join(os.homedir(), ".android/avd");
    const image = avdImageDir(await fsp.readFile(path.join(home, `${avd}.avd`, "config.ini"), "utf8"));
    for (const file of image ? all : []) {
      const sdk = path.dirname(path.dirname(file));
      if (fs.existsSync(path.join(sdk, /** @type {string} */ (image)))) return { file, sdk };
    }
  } catch {
    // no readable config: let the first program work it out
  }
  return { file: all[0], sdk: null };
}

/** @type {{ at: number, list: string[] } | null} */
let avdCache = null;

/** The virtual phones set up on this Mac, by name. Empty when the emulator program is missing. */
async function listAvds() {
  const file = await findEmulator();
  if (!file) return [];
  if (avdCache && Date.now() - avdCache.at < 30_000) return avdCache.list;
  const list = await new Promise((/** @type {(list: string[]) => void} */ resolve) => {
    execFile(file, ["-list-avds"], { timeout: 10_000 }, (err, stdout) => resolve(err ? [] : parseAvdList(String(stdout))));
  });
  avdCache = { at: Date.now(), list };
  return list;
}

// The virtual phone that ran last is the one the button starts. Kept beside the projects, not in them.
const lastAvdFile = () => path.join(app.getPath("userData"), "emulator.json");
/** @type {string | null | undefined} */
let lastAvdName;

function lastAvd() {
  if (lastAvdName !== undefined) return lastAvdName;
  lastAvdName = null;
  try {
    const saved = JSON.parse(fs.readFileSync(lastAvdFile(), "utf8")).avd;
    if (typeof saved === "string") lastAvdName = saved;
  } catch {
    // nothing remembered yet
  }
  return lastAvdName;
}

function rememberAvd(/** @type {string} */ name) {
  if (!/^[A-Za-z0-9._-]+$/.test(name) || name === lastAvd()) return;
  lastAvdName = name;
  try {
    fs.writeFileSync(lastAvdFile(), JSON.stringify({ avd: name }));
  } catch {
    // remembering is a convenience; the first phone in the list is started instead
  }
}

/** The emulator this app started and is still waiting for. @type {{ avd: string, at: number, until: number } | null} */
let launch = null;
/** Why the last start did not work, until the next one. @type {string | null} */
let launchError = null;

/**
 * Whether an emulator is on (running and finished starting up), starting, or off.
 * @param {string} devices what `adb devices` printed
 * @returns {Promise<{ state: "on" | "starting" | "off", avd?: string }>}
 */
async function emulatorState(devices) {
  const emu = emulatorStatus(devices);
  if (emu.state === "ready" && emu.serial) {
    let booted = false;
    let name = "";
    try {
      booted = (await sh(emu.serial, ["getprop", "sys.boot_completed"], 5000)).trim() === "1";
      if (booted) name = (await sh(emu.serial, ["getprop", "ro.boot.qemu.avd_name"], 5000)).trim();
    } catch {
      // it is listed but not answering yet
    }
    if (!booted) return { state: "starting", avd: launch?.avd };
    if (name) rememberAvd(name);
    launch = null;
    launchError = null;
    return { state: "on", avd: name || undefined };
  }
  if (emu.state === "starting") return { state: "starting", avd: launch?.avd };
  if (launch && Date.now() < launch.until) return { state: "starting", avd: launch.avd };
  launch = null;
  return { state: "off" };
}

async function devicesText() {
  try {
    return await adb(["devices"], { timeout: 6000 });
  } catch {
    return "";
  }
}

/**
 * Starts a virtual phone in the emulator's own window and returns at once; the page then asks
 * `phone:info` until it is on. The emulator keeps running when this app quits.
 * @param {unknown} asked the virtual phone's name, or nothing for the one used last
 */
async function launchEmulator(asked) {
  if (!(await findEmulator())) throw new Error("The Android emulator program was not found on this Mac.");
  const now = await emulatorState(await devicesText());
  if (now.state !== "off") return { state: now.state, avd: now.avd ?? "" };
  avdCache = null;
  const avd = pickAvd(await listAvds(), typeof asked === "string" ? asked : null, lastAvd());
  if (!avd) throw new Error("No virtual phone is set up yet. Make one in Android Studio (Device Manager) first.");

  const program = await emulatorFor(avd);
  if (!program) throw new Error("The Android emulator program was not found on this Mac.");

  launchError = null;
  // What the emulator prints goes to a file, so a start that fails can say why.
  const logFile = path.join(app.getPath("userData"), "emulator.log");
  const out = fs.openSync(logFile, "w");
  let child;
  try {
    // The SDK is named so the emulator looks for the phone's system image in the right one.
    const env = program.sdk ? { ...process.env, ANDROID_SDK_ROOT: program.sdk, ANDROID_HOME: program.sdk } : process.env;
    child = spawn(program.file, ["-avd", avd], { detached: true, stdio: ["ignore", out, out], env });
  } finally {
    fs.closeSync(out);
  }
  const mine = { avd, at: Date.now(), until: Date.now() + LAUNCH_WAIT_MS };
  launch = mine;
  child.on("error", (e) => {
    if (launch !== mine) return;
    launch = null;
    launchError = `The emulator could not be started: ${e.message}`.slice(0, 300);
  });
  child.on("exit", (code) => {
    // Still waiting for it and it has gone: the start failed. (Once it is on, `launch` is cleared.)
    if (launch !== mine) return;
    if (code === 0) {
      // A clean exit can be the starter handing over to the emulator proper: give that a moment to appear.
      mine.until = Math.min(mine.until, Date.now() + 30_000);
      return;
    }
    launch = null;
    let log = "";
    try {
      log = fs.readFileSync(logFile, "utf8").slice(-4000);
    } catch {
      // no log; the plain message is used
    }
    launchError = launchFailure(log);
  });
  child.unref();
  return { state: "starting", avd };
}

async function phoneInfo() {
  if (!(await findAdb())) return { available: false, reason: "The Android tool (adb) is not installed on this Mac.", emulator: "off" };
  const devices = await devicesText();
  const emu = await emulatorState(devices);
  /** What the Start button needs: the state, the virtual phones to pick from, and the one it would start. */
  let extra;
  if (emu.state === "on") {
    extra = { emulator: emu.state, avd: emu.avd };
  } else {
    const avds = await listAvds();
    extra = { emulator: emu.state, avds, avd: emu.avd ?? pickAvd(avds, null, lastAvd()) ?? undefined, launchError: launchError ?? undefined };
  }
  // While it starts up nothing is sent anywhere, not even to a real phone that happens to be plugged in.
  if (emu.state === "starting") return { available: false, reason: "The Android emulator is starting up.", ...extra };
  const serial = firstDevice(devices);
  if (!serial) return { available: false, reason: "The Android emulator is off.", ...extra };
  let size = null;
  let instagram = false;
  try {
    size = screenSize(await sh(serial, ["wm", "size"], 6000));
    instagram = (await sh(serial, ["pm", "list", "packages", INSTAGRAM], 8000)).includes(`package:${INSTAGRAM}`);
  } catch {
    // answered once already, so it is there; the details are optional
  }
  return { available: true, device: serial, width: size?.width ?? 1080, height: size?.height ?? 1920, instagram, ...extra };
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
      // The old file goes first: Android's reader gives up on a screen that keeps moving ("could not get
      // idle state"), and the last screen it did read must not be taken for this one.
      const xml = await adb(["shell", "rm -f /sdcard/nocap-ui.xml; uiautomator dump /sdcard/nocap-ui.xml >/dev/null 2>&1; cat /sdcard/nocap-ui.xml"], { serial, timeout: 20_000 });
      if (xml.includes("<hierarchy")) return parseUi(xml);
    } catch {
      // try again
    }
    await wait(700);
  }
  return [];
}

// Instagram's speech bubbles and feed never stop moving, and Android will not read a moving screen.
// For the steps that need those screens (Highlight, cover, Home) the emulator's animations are turned
// off and then put back. Only ever on an emulator: a real phone's settings are left alone.

/** What the speeds were, kept on disk while they are off, so a quit in the middle can still be undone. */
const stillFile = () => path.join(app.getPath("userData"), "emulator-animations.json");
/** @type {{ serial: string, depth: number, before: Promise<Record<string, string>> } | null} */
let still = null;
/** Putting back runs to its end before the speeds are read again. */
let restoring = Promise.resolve();

async function stopAnimations(/** @type {string} */ serial) {
  await restoring;
  /** @type {Record<string, string>} */
  let before = {};
  try {
    // Left over from a run that never finished: those are the real values, not the zeros on the phone now.
    before = JSON.parse(await fsp.readFile(stillFile(), "utf8"));
  } catch {
    for (const key of ANIMATION_KEYS) before[key] = (await sh(serial, ["settings", "get", "global", key], 6000)).trim();
    await fsp.writeFile(stillFile(), JSON.stringify(before));
  }
  for (const key of ANIMATION_KEYS) await sh(serial, ["settings", "put", "global", key, "0"], 6000);
  return before;
}

async function restoreAnimations(/** @type {string} */ serial, /** @type {Record<string, string>} */ before) {
  for (const key of ANIMATION_KEYS) await sh(serial, restoreSetting(key, before[key]), 6000);
  await fsp.rm(stillFile(), { force: true });
}

/**
 * Runs `work` with the emulator's animations off. Calls inside one another share the one switch.
 * @template T
 * @param {string} serial
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
async function withStillScreen(serial, work) {
  if (!serial.startsWith("emulator-")) return work();
  still ??= { serial, depth: 0, before: stopAnimations(serial).catch(() => ({})) };
  const mine = still;
  mine.depth++;
  try {
    await mine.before;
    return await work();
  } finally {
    if (--mine.depth === 0) {
      still = null;
      restoring = mine.before.then((before) => (Object.keys(before).length ? restoreAnimations(serial, before) : undefined)).catch(() => undefined);
      await restoring;
    }
  }
}

/** The app is quitting in the middle of a step: put the speeds back before it goes. */
function restoreAnimationsNow() {
  if (!still || !adbPath) return;
  try {
    const before = JSON.parse(fs.readFileSync(stillFile(), "utf8"));
    for (const key of ANIMATION_KEYS) execFileSync(adbPath, ["-s", still.serial, "shell", restoreSetting(key, before[key]).map(shellQuote).join(" ")], { timeout: 5000 });
    fs.rmSync(stillFile(), { force: true });
  } catch {
    // the file stays, and the next step puts them back
  }
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
  return { shared: await leftScreen(serial, "your_story_share_shortcut_button") };
}

// ---- Highlights -------------------------------------------------------------------------------

/** How long a just-shared Story is given to finish uploading before the Highlight step gives up. */
const UPLOAD_WAIT_MS = 8 * 60_000;

/**
 * Adds the Story that was just shared to one of the account's Highlights, the free way: open the
 * posted Story, More, Highlight, then the Highlight with exactly this name. Sharing straight to a
 * Highlight is a paid Instagram feature, and nothing here goes near that.
 *
 * Nothing is added unless exactly one Highlight has the name. A Story still uploading cannot be
 * read (its spinner never lets the screen settle), so the wait for it is simply "until the screen reads".
 *
 * @param {import("electron").WebContents} sender
 * @param {unknown} rawName
 * @param {unknown} rawMaxAge how recent (minutes) the Story must be to count as the one just shared
 * @returns {Promise<{ added: boolean, note: string }>}
 */
async function addToHighlight(sender, rawName, rawMaxAge) {
  const serial = await requireDevice();
  const name = typeof rawName === "string" ? rawName.trim().slice(0, 60) : "";
  if (!name) return { added: false, note: "No Highlight name was given." };
  const maxAge = typeof rawMaxAge === "number" && rawMaxAge > 0 && rawMaxAge <= 1440 ? rawMaxAge : 20;
  const mine = { cancelled: false };
  job = mine;
  const say = (/** @type {string} */ label) => {
    if (!sender.isDestroyed()) sender.send("phone:step", label);
  };
  const back = () => sh(serial, ["input", "keyevent", "4"]);
  /** Closes whatever of the sheet, the menu and the viewer is still open, without pressing Back past Instagram's feed. */
  const leave = async () => {
    for (let i = 0; i < 4; i++) {
      const nodes = await look(serial);
      if (!nodes.length || findUi(nodes, { id: "feed_tab" })) return;
      await back();
      await wait(900);
    }
  };

  try {
    say("Opening your Story");
    if ((await instagramHome()).state !== "home") return { added: false, note: "Instagram has something else open, so the Story was not added to a Highlight." };
    await wait(1800);
    const feed = await look(serial);
    if (!feed.length) return { added: false, note: "Instagram's home screen could not be read because something on it kept moving, so the Story was not added to a Highlight. Add it by hand: open your Story, More, Highlight." };
    const label = feed.find((n) => n.id === "username" && n.text.trim() === "Your story");
    const entry = label && feed.find((n) => storyOwner(n.desc) !== null && Math.abs(n.x - label.x) < 90 && n.y < label.y);
    const me = entry ? storyOwner(entry.desc) : null;
    if (!entry || !me) return { added: false, note: "Your Story was not found on Instagram's home screen." };
    await tap(serial, entry);

    // Find the Story just shared: the newest of the account's own, once it has finished uploading.
    say("Waiting for Instagram to finish uploading the Story");
    const size = screenSize(await sh(serial, ["wm", "size"], 6000)) ?? { width: 1080, height: 2424 };
    const until = Date.now() + UPLOAD_WAIT_MS;
    let advances = 0;
    let reopened = 0;
    let unknown = 0;
    let opens = 0;
    /** The menu's Highlight row, once the menu is open over the right Story. */
    let row = null;
    while (Date.now() < until) {
      if (mine.cancelled) throw new Stopped("Stopped.");
      const nodes = await look(serial);
      if (!nodes.length) {
        await wait(2500);
        continue;
      }
      if (findUi(nodes, { id: "feed_tab" })) {
        // The viewer closed by itself (it does after the last Story): open it again.
        if (++reopened > 4) break;
        const again = nodes.find((n) => storyOwner(n.desc) === me && n.y < 800);
        if (!again) break;
        await tap(serial, again);
        await wait(1500);
        continue;
      }
      const head = findUi(nodes, { id: "reel_viewer_text_container" });
      if (!head) {
        // An advert between Stories has no heading: if it stays, close it and start from the home screen.
        if (++unknown >= 3) {
          unknown = 0;
          await leave();
        }
        await wait(1200);
        continue;
      }
      unknown = 0;
      if (storyOwner(head.desc) !== me) {
        // Instagram has moved on to other people's Stories: back to the home screen and in again.
        await leave();
        if (++reopened > 4) return { added: false, note: "The Story just shared was not found among your Stories; nothing was added to a Highlight." };
        continue;
      }
      const age = storyAgeMinutes(head.desc);
      const more = findUi(nodes, { id: "self_toolbar_menu_button" });
      if (age !== null && age <= maxAge && more) {
        // Reading a playing Story takes seconds, long enough for Instagram to move on, so More is tapped
        // at once: it pauses the Story. The heading behind the open menu then says which Story it is for.
        await tap(serial, more);
        const menu = await waitFor(serial, { id: "action_sheet_row_text_view", text: "Highlight" }, 12_000);
        const behind = menu && findUi(menu.nodes, { id: "reel_viewer_text_container" });
        const behindAge = behind ? storyAgeMinutes(behind.desc) : null;
        if (menu && behind && storyOwner(behind.desc) === me && behindAge !== null && behindAge <= maxAge) {
          row = menu.hit;
          break;
        }
        if (++opens >= 3) break;
        // Not the Story meant, or no menu: close whatever opened and look again.
        await leave();
        continue;
      }
      // One of the account's older Stories: on to the next.
      if (++advances > 15) break;
      await sh(serial, ["input", "tap", String(Math.round(size.width * 0.9)), String(Math.round(size.height * 0.5))]);
      await wait(1300);
    }
    if (!row) {
      await leave();
      return { added: false, note: "The Story was still uploading, or was not found, so it was not added to a Highlight. Add it by hand from the Story's More menu." };
    }

    say(`Adding the Story to "${name}"`);
    await tap(serial, row);
    const sheet = await waitFor(serial, { id: "header_text", text: "Add to highlights" }, 8000);
    if (!sheet) throw new Error("Instagram did not show the list of Highlights.");

    // The list scrolls sideways; look along it until the name turns up or nothing new comes into view.
    let found = findHighlight(sheet.nodes, name);
    let nodes = sheet.nodes;
    for (let i = 0; i < 8 && found.count === 0; i++) {
      const anyLabel = nodes.find((n) => n.id === "username" && n.y > sheet.hit.y);
      if (!anyLabel) break;
      const before = found.seen.join("|");
      await sh(serial, ["input", "swipe", String(Math.round(size.width * 0.85)), String(anyLabel.y - 110), String(Math.round(size.width * 0.2)), String(anyLabel.y - 110), "450"]);
      await wait(900);
      nodes = await look(serial);
      found = findHighlight(nodes, name);
      if (found.seen.join("|") === before) break;
    }
    if (found.count !== 1 || !found.label) {
      await leave();
      return {
        added: false,
        note: found.count > 1 ? `More than one Highlight is called "${name}", so nothing was added. Give them different names on Instagram.` : `No Highlight is called "${name}", so nothing was added.`,
      };
    }
    const target = found.label;
    const picture = nodes.find((n) => n.id === "avatar_image_view" && Math.abs(n.x - target.x) < 70 && n.y < target.y && target.y - n.y < 260);
    await tap(serial, picture ?? { x: target.x, y: target.y - 124 });
    let gone = false;
    for (let i = 0; i < 5 && !gone; i++) {
      await wait(1200);
      const now = await look(serial);
      gone = now.length > 0 && !findUi(now, { id: "header_text", text: "Add to highlights" });
    }
    await leave();
    return gone ? { added: true, note: `Added to the Highlight "${name}".` } : { added: false, note: `"${name}" was tapped, but Instagram's list stayed open, so check the Highlight on your profile.` };
  } catch (err) {
    await leave().catch(() => undefined);
    if (err instanceof Stopped) return { added: false, note: "Stopped before the Story was added to a Highlight." };
    return { added: false, note: `${err instanceof Error ? err.message : String(err)} Nothing was added to a Highlight.` };
  } finally {
    if (job === mine) job = null;
  }
}

/** How long Instagram is given to leave the screen it was shared from. */
const SHARE_WAIT_MS = 90_000;

/**
 * After a share is tapped: waits for Instagram to leave the screen that has the element `id`.
 * It keeps that screen up while it gets the video ready, which took well over 20 seconds for a
 * real Story on the emulator, so a short wait reported a Story that did post as not shared.
 * Nothing is tapped here: a second tap could post twice. A screen that cannot be read does not count as "left".
 * @param {string} serial @param {string} id
 * @returns {Promise<boolean>} false when the screen was still there (or could not be read) when the time ran out
 */
async function leftScreen(serial, id) {
  const until = Date.now() + SHARE_WAIT_MS;
  while (Date.now() < until) {
    await wait(1500);
    const nodes = await look(serial);
    if (nodes.length > 0 && !findUi(nodes, { id })) return true;
  }
  return false;
}

/** Taps Instagram's Share. Only ever called when the page asks, after its own countdown. */
async function shareReel() {
  const serial = await requireDevice();
  const first = await waitFor(serial, { id: "share_button" }, 8000);
  if (!first) throw new Error("Instagram's Share button is not on screen. Finish in the phone panel.");
  await tap(serial, first.hit);
  // The first time, Instagram puts up a notice about original audio with its own Share button.
  for (let i = 0; i < 4; i++) {
    await wait(1200);
    const nodes = await look(serial);
    const sheetShare = nodes.find((n) => n.text.trim() === "Share" && nodes.some((s) => s.id.startsWith("clips_original_audio_nux_sheet")));
    if (!sheetShare) break;
    await tap(serial, sheetShare);
  }
  return { shared: await leftScreen(serial, "caption_input_text_view") };
}

// ---- Highlight cover --------------------------------------------------------------------------

/** Folder for cover pictures: Android's gallery lists pictures from here. */
const COVER_FOLDER = "/sdcard/Pictures/NoCapEdit";
const COVER_MAX_BYTES = 8 * 1024 * 1024;

/** Copies the cover picture to the phone's gallery, newest first in its list of photos. */
async function pushCover(/** @type {string} */ serial, /** @type {Uint8Array} */ jpeg) {
  await fsp.mkdir(uploadRoot(), { recursive: true });
  const name = `cover-${Date.now()}.jpg`;
  const file = path.join(uploadRoot(), name);
  const remote = `${COVER_FOLDER}/${name}`;
  try {
    await fsp.writeFile(file, jpeg);
    await sh(serial, ["mkdir", "-p", COVER_FOLDER]);
    await adb(["push", file, remote], { serial, timeout: 60_000 });
    await sh(serial, ["content", "call", "--uri", "content://media", "--method", "scan_file", "--arg", remote], 30_000);
  } finally {
    await fsp.rm(file, { force: true });
  }
}

/**
 * Gives the Highlight with exactly this name a new cover picture: press and hold it on the profile,
 * Edit highlight, Edit cover, pick the picture just copied across, Done.
 *
 * The cover is only saved when every screen on the way is the expected one: the Highlight's name on
 * the edit screen matches, and the photo picked is one made in the last few minutes. When something
 * is off, the screens are left without saving; if Instagram then asks whether to discard, that
 * question is left on the phone for the user.
 *
 * @param {import("electron").WebContents} sender
 * @param {unknown} rawName
 * @param {unknown} jpeg
 */
async function setHighlightCover(sender, rawName, jpeg) {
  const serial = await requireDevice();
  const name = typeof rawName === "string" ? rawName.trim().slice(0, 60) : "";
  if (!name) return { set: false, note: "No Highlight name was given." };
  if (!(jpeg instanceof Uint8Array) || jpeg.length < 100 || jpeg.length > COVER_MAX_BYTES || jpeg[0] !== 0xff || jpeg[1] !== 0xd8 || jpeg[2] !== 0xff) {
    return { set: false, note: "The cover picture could not be used." };
  }
  const mine = { cancelled: false };
  job = mine;
  const say = (/** @type {string} */ label) => {
    if (!sender.isDestroyed()) sender.send("phone:step", label);
  };
  const stopCheck = () => {
    if (mine.cancelled) throw new Stopped("Stopped.");
  };
  let asking = false;
  /** Leaves the cover screens without saving, never answering Instagram's "discard?" question itself. */
  const leave = async () => {
    for (let i = 0; i < 5; i++) {
      const nodes = await look(serial);
      if (!nodes.length || findUi(nodes, { id: "feed_tab" })) return;
      if (findUi(nodes, { id: "igds_alert_dialog_headline" })) {
        asking = true;
        return;
      }
      const cancel = findUi(nodes, { id: "profile_picture_cancel_button" });
      if (cancel) await tap(serial, cancel);
      else await sh(serial, ["input", "keyevent", "4"]);
      await wait(1200);
    }
  };
  const notSet = async (/** @type {string} */ why) => {
    await leave().catch(() => undefined);
    const question = asking ? " Instagram is asking whether to discard the change; answer it in the phone panel." : "";
    return { set: false, note: `${why} The cover was not changed.${question}` };
  };
  const need = async (/** @type {{ id?: string, text?: string, desc?: string }} */ want, /** @type {string} */ missing, ms = 10_000) => {
    stopCheck();
    const found = await waitFor(serial, want, ms);
    if (!found) throw new Error(missing);
    return found;
  };

  try {
    say("Sending the cover picture to the phone");
    await pushCover(serial, jpeg);
    stopCheck();

    say(`Opening the Highlight "${name}"`);
    if ((await instagramHome()).state !== "home") return { set: false, note: "Instagram has something else open, so the cover was not changed." };
    await wait(1200);
    const profile = await need({ id: "profile_tab" }, "Instagram's profile button was not found.");
    await tap(serial, profile.hit);
    // A second tap scrolls a profile that was left further down back to the top, where the Highlights are.
    await wait(1500);
    await tap(serial, profile.hit);
    await wait(1800);

    const size = screenSize(await sh(serial, ["wm", "size"], 6000)) ?? { width: 1080, height: 2424 };
    let nodes = await look(serial);
    let found = findHighlight(nodes, name);
    for (let i = 0; i < 8 && found.count === 0; i++) {
      stopCheck();
      const anyLabel = nodes.find((n) => n.id === "username");
      if (!anyLabel) break;
      const before = found.seen.join("|");
      await sh(serial, ["input", "swipe", String(Math.round(size.width * 0.85)), String(anyLabel.y - 124), String(Math.round(size.width * 0.2)), String(anyLabel.y - 124), "450"]);
      await wait(1000);
      nodes = await look(serial);
      found = findHighlight(nodes, name);
      if (found.seen.join("|") === before) break;
    }
    if (found.count !== 1 || !found.label) {
      return await notSet(found.count > 1 ? `More than one Highlight is called "${name}".` : `No Highlight called "${name}" was found on your profile.`);
    }
    const target = found.label;
    const picture = nodes.find((n) => n.id === "avatar_image_view" && Math.abs(n.x - target.x) < 70 && n.y < target.y && target.y - n.y < 260);
    const at = picture ?? { x: target.x, y: target.y - 124 };
    stopCheck();
    await sh(serial, ["input", "swipe", String(at.x), String(at.y), String(at.x), String(at.y), "1200"]);
    await tap(serial, (await need({ id: "context_menu_item_label", text: "Edit highlight" }, "Instagram did not offer Edit highlight.")).hit);

    // The edit screen must be for this Highlight and no other.
    const title = await need({ id: "highlight_title" }, "Instagram's edit screen did not open.");
    if (title.hit.text.trim().toLowerCase() !== name.toLowerCase()) return await notSet(`Instagram opened "${title.hit.text.trim()}" instead of "${name}".`);

    say("Choosing the new cover");
    await tap(serial, (await need({ id: "edit_cover_link" }, "Instagram's Edit cover was not found.")).hit);
    await tap(serial, (await need({ desc: "Open Gallery" }, "Instagram's photo button was not found.")).hit);
    const grid = await need({ id: "gallery_grid_item_thumbnail" }, "Instagram did not show your photos. It may be asking for permission in the phone panel.", 12_000);

    // The first photo in the list must be the one just copied across.
    const first = grid.nodes.filter((n) => n.id === "gallery_grid_item_thumbnail").sort((a, b) => a.y - b.y || a.x - b.x)[0];
    const now = wallMinutes(await sh(serial, ["date", "+%Y-%m-%d %H:%M"], 6000));
    const made = thumbnailMinutes(first.desc);
    if (now === null || made === null || now - made > 5 || made - now > 3) return await notSet("Instagram's photo list did not show the new picture first.");
    if (first.desc.startsWith("Unselected")) {
      await tap(serial, first);
      await wait(900);
    }
    stopCheck();
    await tap(serial, (await need({ id: "profile_picture_done_button" }, "Instagram's Done button was not found.")).hit);
    await wait(2000);

    // Instagram comes back to Edit cover (Done again) or straight to the edit screen.
    let screen = await look(serial);
    if (!findUi(screen, { id: "highlight_title" })) {
      const done = findUi(screen, { desc: "Done" });
      if (!done) return await notSet("Instagram's cover screen did not look as expected.");
      stopCheck();
      await tap(serial, done);
      await wait(2000);
      screen = await look(serial);
    }
    const again = findUi(screen, { id: "highlight_title" });
    const save = findUi(screen, { desc: "Done" });
    if (!again || !save || again.text.trim().toLowerCase() !== name.toLowerCase()) return await notSet("Instagram's edit screen did not come back as expected.");

    say("Saving the new cover");
    stopCheck();
    await tap(serial, save);
    // Saved once the edit screen is gone. Instagram may then offer to post the Highlight to the Story: Back closes that.
    let saved = false;
    for (let i = 0; i < 8; i++) {
      await wait(1500);
      const after = await look(serial);
      if (!after.length) continue;
      if (findUi(after, { text: "Try it" })) {
        saved = true;
        await sh(serial, ["input", "keyevent", "4"]);
        break;
      }
      if (!findUi(after, { id: "highlight_title" })) {
        saved = true;
        if (i >= 3) break;
      }
    }
    return saved
      ? { set: true, note: `Gave "${name}" a new cover.` }
      : { set: false, note: `Done was tapped, but Instagram stayed on the edit screen, so check "${name}" on your profile.` };
  } catch (err) {
    if (err instanceof Stopped) return await notSet("Stopped.");
    return await notSet(err instanceof Error ? err.message : String(err));
  } finally {
    if (job === mine) job = null;
  }
}

// ---- The fixed list the page can call --------------------------------------------------------

export function registerPhone() {
  fs.rmSync(uploadRoot(), { recursive: true, force: true });
  app.on("will-quit", () => {
    restoreAnimationsNow();
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
  handle("phone:launch", (_event, avd) => launchEmulator(avd));

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
  handle("phone:instagramHome", async () => withStillScreen(await requireDevice(), () => instagramHome()));
  handle("phone:reel", (event, uri, options) => runReel(event.sender, String(uri), options && typeof options === "object" ? options : {}));
  handle("phone:story", (event, uri, options) => runStory(event.sender, String(uri), options && typeof options === "object" ? options : {}));
  handle("phone:shareStory", (_event, audience) => shareStory(audience));
  handle("phone:highlight", async (event, name, maxAgeMinutes) => withStillScreen(await requireDevice(), () => addToHighlight(event.sender, name, maxAgeMinutes)));
  handle("phone:highlightCover", async (event, name, jpeg) => withStillScreen(await requireDevice(), () => setHighlightCover(event.sender, name, jpeg)));
  handle("phone:cancel", () => {
    if (job) job.cancelled = true;
  });
  handle("phone:share", () => shareReel());
}
