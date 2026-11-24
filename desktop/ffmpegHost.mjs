// Runs the real ffmpeg program for the page (docs/DESKTOP_PLAN.md, step 5).
//
// The page's export code was written for ffmpeg.wasm: write some files, run a command, read the
// result. This file offers the same three things on real files. Each "session" is a private
// temporary work folder; ffmpeg runs inside it, in a macOS sandbox that allows no network, no
// writing outside the folder and no reading of the home folder. Media reaches the folder only as
// bytes the page sends, never as a path on disk.
import { app, ipcMain } from "electron";
import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppUrl } from "./lib/appUrl.mjs";
import { checkArgs, missingForArgs, parseCapabilities, rewriteArgs, sandboxProfile, sessionPath, topName } from "./lib/ffmpegArgs.mjs";

const SANDBOX = "/usr/bin/sandbox-exec";
/** @typedef {{ dir: string, names: Set<string>, child: import("node:child_process").ChildProcess | null, sender: import("electron").WebContents }} Session */
/** @type {Map<string, Session>} */
const sessions = new Map();
let nextId = 1;

/** @type {Promise<{ path: string, version: string, encoders: string[], filters: string[], missing: string[], usable: boolean } | null> | null} */
let found = null;

/** All work folders live here; it is emptied when the app starts and when it quits. */
function workRoot() {
  return path.join(fs.realpathSync(app.getPath("temp")), "nocap-edit-ffmpeg");
}

/** @param {string} file @param {string[]} args @returns {Promise<string>} */
function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => (err ? reject(err) : resolve(`${stdout}\n${stderr}`)));
  });
}

/** Where an ffmpeg may be: NOCAP_FFMPEG, the app's own copy (a later step installs one), then Homebrew. */
function candidates() {
  return [process.env.NOCAP_FFMPEG, path.join(app.getPath("userData"), "bin", "ffmpeg"), "/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].filter((p) => typeof p === "string" && p !== "");
}

function findFfmpeg() {
  found ??= (async () => {
    if (process.env.NOCAP_FFMPEG === "off" || !fs.existsSync(SANDBOX)) return null;
    for (const file of candidates()) {
      try {
        await fsp.access(file, fs.constants.X_OK);
        const version = (await run(file, ["-hide_banner", "-version"])).match(/ffmpeg version (\S+)/)?.[1] ?? "unknown";
        const caps = parseCapabilities(await run(file, ["-hide_banner", "-encoders"]), await run(file, ["-hide_banner", "-filters"]));
        if (caps.usable) return { path: file, version, ...caps };
      } catch {
        // not here, or not runnable; try the next place
      }
    }
    return null;
  })();
  return found;
}

/** @param {import("electron").IpcMainInvokeEvent} event */
function trusted(event) {
  return !!event.senderFrame && event.senderFrame === event.sender.mainFrame && isAppUrl(event.senderFrame.url);
}

/** @param {import("electron").IpcMainInvokeEvent} event @param {unknown} id @returns {Session} */
function sessionOf(event, id) {
  const s = typeof id === "string" ? sessions.get(id) : undefined;
  if (!s || s.sender !== event.sender) throw new Error("unknown ffmpeg session");
  return s;
}

/** @param {Session} s @param {unknown} name @returns {string} */
function pathIn(s, name) {
  const full = typeof name === "string" ? sessionPath(s.dir, name) : null;
  if (!full) throw new Error("that file is outside the work folder");
  return full;
}

/** @param {string} id */
async function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  s.child?.kill("SIGKILL");
  await fsp.rm(s.dir, { recursive: true, force: true }).catch(() => {});
}

/**
 * @template {unknown[]} A
 * @param {string} channel
 * @param {(event: import("electron").IpcMainInvokeEvent, ...args: A) => unknown} fn
 */
function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!trusted(event)) throw new Error("not allowed");
    return fn(event, .../** @type {A} */ (args));
  });
}

export function registerFfmpegHost() {
  fs.rmSync(workRoot(), { recursive: true, force: true });
  app.on("will-quit", () => {
    for (const s of sessions.values()) s.child?.kill("SIGKILL");
    fs.rmSync(workRoot(), { recursive: true, force: true });
  });

  handle("ffmpeg:info", async () => {
    const f = await findFfmpeg();
    return f ? { available: true, version: f.version, missing: f.missing, encoders: f.encoders } : { available: false };
  });

  handle("ffmpeg:open", async (event) => {
    if (!(await findFfmpeg())) throw new Error("no ffmpeg");
    const id = `s${nextId++}_${Date.now().toString(36)}`;
    const dir = path.join(workRoot(), id);
    await fsp.mkdir(dir, { recursive: true });
    sessions.set(id, { dir, names: new Set(), child: null, sender: event.sender });
    event.sender.once("destroyed", () => void closeSession(id));
    return id;
  });

  handle("ffmpeg:close", (_event, id) => closeSession(String(id)));

  handle("ffmpeg:write", async (event, id, name, data, append) => {
    const s = sessionOf(event, id);
    const file = pathIn(s, name);
    if (!(data instanceof Uint8Array)) throw new Error("data must be bytes");
    s.names.add(topName(String(name)));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await (append ? fsp.appendFile(file, data) : fsp.writeFile(file, data));
  });

  handle("ffmpeg:read", async (event, id, name) => {
    const s = sessionOf(event, id);
    const buf = await fsp.readFile(pathIn(s, name));
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  handle("ffmpeg:mkdir", async (event, id, name) => {
    const s = sessionOf(event, id);
    s.names.add(topName(String(name)));
    await fsp.mkdir(pathIn(s, name), { recursive: true });
  });

  handle("ffmpeg:remove", async (event, id, name) => {
    const s = sessionOf(event, id);
    await fsp.rm(pathIn(s, name), { recursive: true, force: true });
  });

  handle("ffmpeg:exec", async (event, id, rawArgs) => {
    const s = sessionOf(event, id);
    const ff = await findFfmpeg();
    if (!ff) throw new Error("no ffmpeg");
    if (s.child) throw new Error("ffmpeg is already running in this session");
    if (!Array.isArray(rawArgs) || rawArgs.some((a) => typeof a !== "string")) throw new Error("bad arguments");
    const args = rewriteArgs(rawArgs, s.names);
    const refused = checkArgs(args);
    if (refused) return { code: -1, refused: `This command was not run because it has ${refused}.` };
    const lacking = missingForArgs(args, ff.missing);
    if (lacking.length) return { code: -1, unsupported: lacking };

    const profile = sandboxProfile(s.dir, os.homedir());
    // -nostdin: ffmpeg must never wait for a key press. The page's own -y / -hide_banner stay as they are.
    const child = spawn(SANDBOX, ["-p", profile, ff.path, "-nostdin", ...args], {
      cwd: s.dir,
      env: { PATH: "/usr/bin:/bin", HOME: s.dir, TMPDIR: s.dir, LANG: "en_US.UTF-8" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    s.child = child;
    let tail = "";
    const emit = (/** @type {string} */ line) => {
      if (line && !s.sender.isDestroyed()) s.sender.send("ffmpeg:log", id, line);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (/** @type {string} */ chunk) => {
      // ffmpeg ends progress lines with \r and everything else with \n.
      const parts = (tail + chunk).split(/[\r\n]/);
      tail = parts.pop() ?? "";
      for (const line of parts) emit(line);
    });
    return await new Promise((resolve) => {
      child.on("error", (err) => {
        s.child = null;
        resolve({ code: -1, crashed: String(err.message) });
      });
      child.on("close", (code, signal) => {
        s.child = null;
        emit(tail);
        resolve(signal ? { code: -1, crashed: `ffmpeg was stopped (${signal})` } : { code: code ?? -1 });
      });
    });
  });
}
