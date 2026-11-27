// Scheduled Instagram Stories (the `schedule` list in desktop/preload.cjs).
//
// The app keeps the queue and posts at the set time, so it works with the window closed. When to post
// and what state a post is in are decided by lib/schedule.mjs and lib/scheduleRunner.mjs (tested);
// the phone steps are phoneHost.mjs. This file keeps the files, runs the clock and tells the user.
//
// The page never names a path: a picture or video is chosen in the Mac's own file window, and the
// app copies it into its data folder (schedule/), so the original can be renamed or deleted.
import { app, BrowserWindow, dialog, ipcMain, Notification, powerMonitor, powerSaveBlocker } from "electron";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { savedFolder } from "./exportFolderHost.mjs";
import { findFfmpeg } from "./ffmpegHost.mjs";
import { postScheduledStory, stopScheduledStory, warmPhone } from "./phoneHost.mjs";
import { isAppUrl } from "./lib/appUrl.mjs";
import { typeable } from "./lib/phone.mjs";
import { emptyQueue, keepsRunning, LATE_LIMIT_MS, newItem, parseQueue, parseWanted } from "./lib/schedule.mjs";
import { createScheduleRunner } from "./lib/scheduleRunner.mjs";

/** @typedef {import("./lib/schedule.mjs").Item} Item */
/** @typedef {import("./lib/schedule.mjs").Wanted} Wanted */
/** @typedef {{ name: string, source: "picture" | "video" }} Draft */

const PICTURES = [".jpg", ".jpeg", ".png", ".webp"];
const VIDEOS = [".mp4", ".m4v", ".mov"];
/** How long a picture stays up as a Story. */
const STILL_SECONDS = 15;
const TICK_MS = 15_000;

/**
 * The phone steps. Tests replace them from the main process (`globalThis.nocapScheduleFake`), which
 * nothing in the page can reach, so a test run never drives the emulator.
 * @returns {{ postScheduledStory: typeof postScheduledStory, stopScheduledStory: typeof stopScheduledStory, warmPhone: typeof warmPhone }}
 */
const phone = () => /** @type {any} */ (globalThis).nocapScheduleFake ?? { postScheduledStory, stopScheduledStory, warmPhone };

const root = () => path.join(app.getPath("userData"), "schedule");
const filesDir = () => path.join(root(), "files");
const queueFile = () => path.join(root(), "queue.json");
const videoFile = (/** @type {string} */ id) => path.join(filesDir(), `${id}.mp4`);
const thumbFile = (/** @type {string} */ id) => path.join(filesDir(), `${id}.jpg`);

/** @type {ReturnType<typeof createScheduleRunner> | null} */
let runner = null;
/** @type {Map<string, Draft>} */
const drafts = new Map();
/** @type {Map<string, string>} */
const thumbs = new Map();
let step = "";
/** @type {number | null} */
let blocker = null;
let quitAnyway = false;
/** @type {() => void} */
let showSchedule = () => {};

/** True while closing the window must not quit the app: something is waiting to be posted. */
export function scheduleKeepsRunning() {
  return !!runner && keepsRunning(runner.state().queue);
}

/** @param {string} id */
function thumbOf(id) {
  let data = thumbs.get(id);
  if (data === undefined) {
    try {
      data = `data:image/jpeg;base64,${fs.readFileSync(thumbFile(id)).toString("base64")}`;
    } catch {
      data = "";
    }
    thumbs.set(id, data);
  }
  return data;
}

function pageState() {
  const { queue, running } = /** @type {NonNullable<typeof runner>} */ (runner).state();
  return {
    items: queue.items.map((item) => ({ ...item, thumb: thumbOf(item.id) })).sort((a, b) => a.at - b.at),
    paused: queue.paused,
    running,
    step: running ? step : "",
  };
}

function tellPage() {
  if (!runner) return;
  const state = pageState();
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send("schedule:changed", state);
}

/** Keeps the Mac from sleeping while something is waiting (a closed lid still sleeps). */
function holdAwake() {
  const wanted = scheduleKeepsRunning();
  if (wanted && blocker === null) blocker = powerSaveBlocker.start("prevent-app-suspension");
  else if (!wanted && blocker !== null) {
    powerSaveBlocker.stop(blocker);
    blocker = null;
  }
}

/** Removes the copies nothing refers to any more. Posted ones keep only their small picture. */
function tidyFiles() {
  if (!runner) return;
  const items = runner.state().queue.items;
  let names;
  try {
    names = fs.readdirSync(filesDir());
  } catch {
    return;
  }
  for (const name of names) {
    const id = name.split(".")[0];
    const item = items.find((i) => i.id === id);
    const keep = drafts.has(id) || (!!item && (item.status !== "shared" || name.endsWith(".jpg")));
    if (!keep) fs.rmSync(path.join(filesDir(), name), { force: true });
  }
}

/** @param {string} title @param {string} body */
function say(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const note = new Notification({ title, body });
    note.on("click", () => showSchedule());
    note.show();
  } catch (error) {
    console.error("[schedule] notification failed:", error);
  }
}

/** @param {"headsUp" | "shared" | "needsYou" | "missed"} kind @param {Item} item */
function notify(kind, item) {
  const time = new Date(item.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (kind === "headsUp") say("Story coming up", `"${item.name}" posts at ${time}. Open NoCap Edit to postpone or remove it.`);
  else if (kind === "shared") say("Story shared", `"${item.name}" was shared.`);
  else if (kind === "missed") say("Story missed", `"${item.name}" (${time}) was not posted. Its time passed.`);
  else say("A Story needs you", `"${item.name}": ${item.note}`);
}

/** @param {Item} item @param {{ beforeShare(): boolean }} hooks */
async function post(item, hooks) {
  const file = videoFile(item.id);
  if (!fs.existsSync(file)) return { shared: false, why: "The app's copy of the file is gone. Remove this and schedule it again.", tapped: false };
  const setStep = (/** @type {string} */ label) => {
    step = label;
    tellPage();
  };
  try {
    return await phone().postScheduledStory(
      { file, name: `scheduled-${item.id}`, audience: item.audience, highlight: item.highlight, options: item.options, until: item.at + LATE_LIMIT_MS },
      { step: setStep, beforeShare: () => hooks.beforeShare() },
    );
  } finally {
    step = "";
  }
}

function tick() {
  runner?.tick().then(() => tidyFiles()).catch((error) => console.error("[schedule]", error));
}

// ---- Preparing a picked file ------------------------------------------------------------------

/** @param {string} program @param {string[]} args @returns {Promise<{ code: number, log: string }>} */
function ffmpegRun(program, args) {
  return new Promise((resolve) => {
    execFile(program, args, { timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024 }, (error, _out, log) => resolve({ code: error ? 1 : 0, log: String(log) }));
  });
}

/**
 * Makes the app's own Story video (and small picture) from the picked file.
 * @param {string} source @param {string} id @returns {Promise<"picture" | "video">}
 */
async function prepare(source, id) {
  const ff = await findFfmpeg();
  if (!ff) throw new Error("The ffmpeg program was not found on this Mac, and scheduling needs it.");
  const ext = path.extname(source).toLowerCase();
  const picture = PICTURES.includes(ext);
  if (!picture && !VIDEOS.includes(ext)) throw new Error("Pick a picture (JPG, PNG, WebP) or a video (MP4, MOV).");
  await fsp.mkdir(filesDir(), { recursive: true });
  const out = videoFile(id);
  // file: stops a name with a colon in it from being read as an address.
  const input = `file:${source}`;
  const silence = ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];
  const base = ["-y", "-hide_banner", "-nostdin"];
  /** @type {string[]} */
  let args;
  if (picture) {
    // A still video, with a silent sound track so Instagram has a sound to mute and replace with a song.
    args = [...base, "-loop", "1", "-framerate", "30", "-i", input, ...silence, "-t", String(STILL_SECONDS),
      "-vf", "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p",
      "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", out];
  } else {
    const probe = await ffmpegRun(ff.path, ["-hide_banner", "-i", input]);
    if (!/Stream #.*Video:/.test(probe.log)) throw new Error("That file has no picture the app can read.");
    args = /Stream #.*Audio:/.test(probe.log)
      ? [...base, "-i", input, "-c", "copy", "-movflags", "+faststart", out]
      : [...base, "-i", input, ...silence, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-shortest", "-movflags", "+faststart", out];
  }
  let made = await ffmpegRun(ff.path, args);
  // Some sound or picture kinds cannot be put into an MP4 as they are: encode them again.
  if (made.code !== 0 && !picture) {
    made = await ffmpegRun(ff.path, [...base, "-i", input, "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", out]);
  }
  if (made.code !== 0) throw new Error("The app could not read that file.");
  await ffmpegRun(ff.path, [...base, "-i", out, "-frames:v", "1", "-vf", "scale=180:-2", thumbFile(id)]);
  return picture ? "picture" : "video";
}

/** @param {string} id */
function dropDraft(id) {
  if (!drafts.delete(id)) return;
  thumbs.delete(id);
  fs.rmSync(videoFile(id), { force: true });
  fs.rmSync(thumbFile(id), { force: true });
}

/**
 * The user's choices, checked: the time rules, and that Instagram can type every character asked for.
 * @param {unknown} raw @returns {{ ok: true, value: Wanted } | { ok: false, why: string }}
 */
function checked(raw) {
  const parsed = parseWanted(raw, Date.now());
  if (!parsed.ok) return parsed;
  const { overlay, linkLabel } = parsed.value.options;
  const dropped = [...typeable(overlay).dropped, ...typeable(linkLabel).dropped];
  if (dropped.length > 0) return { ok: false, why: `Instagram's text boxes cannot type ${[...new Set(dropped)].join(" ")}. Take it out, or put it in the picture itself.` };
  return parsed;
}

// ---- The fixed list the page can call ---------------------------------------------------------

/** @param {Electron.IpcMainInvokeEvent} event */
function trusted(event) {
  return !!event.senderFrame && event.senderFrame === event.sender.mainFrame && isAppUrl(event.senderFrame.url);
}

/** @param {string} channel @param {(event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown} fn */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error("not allowed");
    return fn(event, ...args);
  });
}

function loadQueue() {
  let text;
  try {
    text = fs.readFileSync(queueFile(), "utf8");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return emptyQueue();
    throw error;
  }
  const queue = parseQueue(text);
  if (queue) return queue;
  // Unreadable: set it and its files aside rather than lose them, and say so.
  const aside = Date.now();
  fs.renameSync(queueFile(), path.join(root(), `queue.broken-${aside}.json`));
  if (fs.existsSync(filesDir())) fs.renameSync(filesDir(), path.join(root(), `files.broken-${aside}`));
  say("The schedule could not be read", "Nothing will be posted from it. Check what was scheduled and add it again.");
  return emptyQueue();
}

/** @param {{ show: () => void }} app_ */
export function registerSchedule({ show }) {
  showSchedule = show;
  fs.mkdirSync(root(), { recursive: true });
  const saved = loadQueue();
  fs.mkdirSync(filesDir(), { recursive: true });
  runner = createScheduleRunner({
    queue: saved,
    save: (queue) => {
      const part = `${queueFile()}.part`;
      fs.writeFileSync(part, JSON.stringify(queue, null, 2));
      fs.renameSync(part, queueFile());
    },
    now: () => Date.now(),
    post,
    stopPost: () => phone().stopScheduledStory(),
    warmUp: () => void phone().warmPhone(),
    notify,
    changed: () => {
      try {
        holdAwake();
        tellPage();
      } catch (error) {
        console.error("[schedule]", error);
      }
    },
  });
  const queue = () => /** @type {NonNullable<typeof runner>} */ (runner);
  tidyFiles();
  holdAwake();

  setInterval(tick, TICK_MS);
  setTimeout(tick, 4000);
  powerMonitor.on("resume", () => setTimeout(tick, 4000));

  // Quitting would leave the waiting Stories unposted, so it is asked first.
  app.on("before-quit", (event) => {
    if (quitAnyway || !scheduleKeepsRunning()) return;
    event.preventDefault();
    void dialog
      .showMessageBox({
        type: "warning",
        buttons: ["Keep Running", "Quit Anyway"],
        defaultId: 0,
        cancelId: 0,
        message: "A Story is still scheduled",
        detail: "NoCap Edit has to be open to post it. Closing the window is fine; quitting is not.",
      })
      .then(({ response }) => {
        if (response !== 1) return;
        quitAnyway = true;
        app.quit();
      });
  });

  handle("schedule:state", () => pageState());
  handle("schedule:pick", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    /** @type {Electron.OpenDialogOptions} */
    const options = {
      title: "Pick a picture or video for the Story",
      defaultPath: savedFolder() ?? app.getPath("desktop"),
      properties: ["openFile"],
      filters: [{ name: "Pictures and videos", extensions: [...PICTURES, ...VIDEOS].map((e) => e.slice(1)) }],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const source = picked.filePaths[0];
    if (picked.canceled || !source) return null;
    const id = randomUUID().replace(/-/g, "").slice(0, 12);
    const name = path.basename(source);
    drafts.set(id, { name, source: "video" });
    try {
      const kind = await prepare(source, id);
      drafts.set(id, { name, source: kind });
      return { draftId: id, name, source: kind, thumb: thumbOf(id) };
    } catch (error) {
      dropDraft(id);
      throw error;
    }
  });
  handle("schedule:discard", (_event, id) => dropDraft(String(id)));
  handle("schedule:add", (_event, id, wanted) => {
    const draft = drafts.get(String(id));
    if (!draft) return { ok: false, why: "Pick the file again." };
    const parsed = checked(wanted);
    if (!parsed.ok) return parsed;
    try {
      queue().add(newItem(String(id), draft.name, draft.source, parsed.value, Date.now()));
    } catch {
      return { ok: false, why: "Could not save the schedule to disk." };
    }
    drafts.delete(String(id));
    tick();
    return { ok: true };
  });
  handle("schedule:change", (_event, id, wanted) => {
    const parsed = checked(wanted);
    if (!parsed.ok) return parsed;
    const result = queue().change(String(id), parsed.value);
    tick();
    return result;
  });
  handle("schedule:remove", (_event, id) => {
    const result = queue().remove(String(id));
    if (result.ok) {
      thumbs.delete(String(id));
      tidyFiles();
    }
    return result;
  });
  handle("schedule:postNow", (_event, id) => {
    const result = queue().postNow(String(id));
    if (result.ok) tick();
    return result;
  });
  handle("schedule:postpone", (_event, id) => queue().postpone(String(id)));
  handle("schedule:pause", (_event, paused) => {
    queue().setPaused(paused === true);
    tick();
  });
  handle("schedule:stop", () => queue().stop());
}
