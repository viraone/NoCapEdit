// Saving exports into one folder the user picked (the `exportFolder` list in desktop/preload.cjs).
//
// The page can make new files, with a plain name and an export extension, inside that folder, and
// read back a file it just saved. It cannot name the folder or any path: the folder comes only from
// the Mac's own folder window (or the settings file in the app's data folder). Nothing is ever
// overwritten, and a file is hidden under a .part name until it is complete.
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { isAppUrl } from "./lib/appUrl.mjs";
import { numberedName, partName, safeExportName } from "./lib/exportFolder.mjs";

const settingsFile = () => path.join(app.getPath("userData"), "export-folder.json");

/** @returns {string | null} */
function savedFolder() {
  try {
    const { folder } = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return typeof folder === "string" && path.isAbsolute(folder) ? folder : null;
  } catch {
    return null;
  }
}

/** What the page is told: the folder, its short name, and whether it is still there. */
function folderInfo() {
  const folder = savedFolder();
  if (!folder) return null;
  let ok = false;
  try {
    ok = fs.statSync(folder).isDirectory();
  } catch {
    // moved, deleted or on a drive that is not plugged in
  }
  return { path: folder, name: path.basename(folder), ok };
}

/**
 * One file being saved.
 * @typedef {{ folder: string, name: string, part: string, handle: import("node:fs/promises").FileHandle | null, final: string | null, sender: Electron.WebContents }} Save
 */
/** @type {Map<string, Save>} */
const saves = new Map();

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

/** @param {Electron.IpcMainInvokeEvent} event @param {unknown} id */
function saveOf(event, id) {
  const save = saves.get(String(id));
  if (!save || save.sender !== event.sender) throw new Error("no such file");
  return save;
}

/** Removes a file that was never finished. A finished one is the user's and stays. @param {string} id */
async function drop(id) {
  const save = saves.get(id);
  if (!save) return;
  saves.delete(id);
  if (save.final) return;
  await save.handle?.close().catch(() => undefined);
  await fsp.rm(save.part, { force: true }).catch(() => undefined);
}

export function registerExportFolder() {
  app.on("will-quit", () => {
    for (const save of saves.values()) if (!save.final) fs.rmSync(save.part, { force: true });
  });

  handle("exportFolder:info", () => folderInfo());

  handle("exportFolder:choose", async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    /** @type {Electron.OpenDialogOptions} */
    const options = {
      title: "Save exports in",
      buttonLabel: "Save exports here",
      defaultPath: savedFolder() ?? app.getPath("desktop"),
      properties: ["openDirectory", "createDirectory"],
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || !picked.filePaths[0]) return null;
    await fsp.writeFile(settingsFile(), JSON.stringify({ folder: picked.filePaths[0] }));
    return folderInfo();
  });

  handle("exportFolder:clear", () => fsp.rm(settingsFile(), { force: true }));

  handle("exportFolder:open", async (event, name) => {
    const safe = safeExportName(name);
    if (!safe) throw new Error("That file name cannot be used.");
    const folder = savedFolder();
    if (!folder) throw new Error("No save folder is chosen.");
    const id = randomUUID().slice(0, 8);
    const part = path.join(folder, partName(safe, id));
    let file;
    try {
      file = await fsp.open(part, "ax");
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      const why = code === "ENOENT" ? "it is no longer there" : code === "EPERM" || code === "EACCES" ? "the Mac did not allow it" : code === "ENOSPC" ? "the disk is full" : String(code ?? "unknown error");
      throw new Error(`Could not save into the folder "${path.basename(folder)}": ${why}.`);
    }
    saves.set(id, { folder, name: safe, part, handle: file, final: null, sender: event.sender });
    event.sender.once("destroyed", () => void drop(id));
    return id;
  });

  handle("exportFolder:write", async (event, id, data) => {
    const save = saveOf(event, id);
    if (!save.handle) throw new Error("that file is already finished");
    if (!(data instanceof Uint8Array)) throw new Error("data must be bytes");
    await save.handle.appendFile(data);
  });

  // A render that starts over: the file is opened for appending, so writing resumes at the start.
  handle("exportFolder:reset", async (event, id) => {
    const save = saveOf(event, id);
    if (!save.handle) throw new Error("that file is already finished");
    await save.handle.truncate(0);
  });

  handle("exportFolder:close", async (event, id) => {
    const save = saveOf(event, id);
    if (!save.handle) throw new Error("that file is already finished");
    await save.handle.close();
    save.handle = null;
    for (let n = 1; n <= 999; n++) {
      const name = numberedName(save.name, n);
      const target = path.join(save.folder, name);
      if (fs.existsSync(target)) continue;
      await fsp.rename(save.part, target);
      save.final = target;
      return { name, folder: path.basename(save.folder) };
    }
    throw new Error("There are too many files with that name.");
  });

  handle("exportFolder:read", async (event, id) => {
    const save = saveOf(event, id);
    if (!save.final) throw new Error("that file is not finished");
    const buf = await fsp.readFile(save.final);
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  });

  handle("exportFolder:abort", (event, id) => {
    saveOf(event, id);
    return drop(String(id));
  });

  handle("exportFolder:reveal", (event, id) => {
    const save = saveOf(event, id);
    if (save.final) shell.showItemInFolder(save.final);
  });
}
