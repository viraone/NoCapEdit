// NoCap Edit desktop shell (docs/DESKTOP_PLAN.md, step 2).
// Shows the static site built into out/ in one window at app://nocap/, with the three
// cross-origin isolation headers the multi-threaded ffmpeg export needs.
//
// NEVER change APP_ORIGIN (desktop/lib/appUrl.mjs) or APP_NAME below: projects live in
// IndexedDB, which is tied to the origin and to the userData folder named after the app.
// Changing either makes every saved project disappear.
import { app, BrowserWindow, Menu, protocol, screen, shell } from "electron";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { APP_ORIGIN, APP_SCHEME, contentType, fileCandidates, isAppUrl, isExternalUrl, isolationHeaders } from "./lib/appUrl.mjs";

const APP_NAME = "NoCap Edit";
/** The built site. NOCAP_OUT is for tests; normally out/ next to desktop/. */
const SITE_ROOT = path.resolve(process.env.NOCAP_OUT ?? path.join(import.meta.dirname, "..", "out"));

app.setName(APP_NAME);
// NOCAP_DATA_DIR keeps test runs away from the real projects.
if (process.env.NOCAP_DATA_DIR) app.setPath("userData", path.resolve(process.env.NOCAP_DATA_DIR));
else app.setPath("userData", path.join(app.getPath("appData"), APP_NAME));

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, allowServiceWorkers: true } },
]);

/** @param {Request} request */
async function serveSite(request) {
  for (const file of fileCandidates(SITE_ROOT, request.url)) {
    try {
      const info = await fsp.stat(file);
      if (!info.isFile()) continue;
      const data = await fsp.readFile(file);
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": contentType(file), "Cache-Control": "no-store", ...isolationHeaders() },
      });
    } catch {
      // not this candidate; try the next
    }
  }
  return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain", ...isolationHeaders() } });
}

// ---- window size and position, remembered between runs ----
const stateFile = () => path.join(app.getPath("userData"), "window-state.json");

function readWindowState() {
  const fallback = { width: 1500, height: 950 };
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (!(saved.width >= 800 && saved.height >= 500)) return fallback;
    // Only reuse the position if it is still on a connected screen.
    const onScreen = screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return saved.x >= a.x - 50 && saved.y >= a.y - 50 && saved.x < a.x + a.width - 100 && saved.y < a.y + a.height - 100;
    });
    return onScreen ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height } : { width: saved.width, height: saved.height };
  } catch {
    return fallback;
  }
}

/** @param {BrowserWindow} win */
function saveWindowState(win) {
  if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(win.getNormalBounds()));
  } catch {
    // losing the window position is harmless
  }
}

/** @type {BrowserWindow | null} */
let mainWindow = null;

function createWindow() {
  const win = new BrowserWindow({
    ...readWindowState(),
    minWidth: 800,
    minHeight: 500,
    title: APP_NAME,
    backgroundColor: "#0b0b0f",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow = win;
  win.on("close", () => saveWindowState(win));
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // The page stays inside the app. Links to other sites open in the default browser.
  win.webContents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  void win.loadURL(`${APP_ORIGIN}/`);
  return win;
}

function buildMenu() {
  /** @type {import("electron").MenuItemConstructorOptions[]} */
  const template = [
    { role: "appMenu" },
    { role: "fileMenu" },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { label: "Start Screen", accelerator: "CmdOrCtrl+Shift+H", click: () => void mainWindow?.loadURL(`${APP_ORIGIN}/`) },
        { type: "separator" },
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// One copy at a time: two copies would write to the same project database.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    if (!fs.existsSync(path.join(SITE_ROOT, "index.html"))) {
      console.error(`[desktop] no built site at ${SITE_ROOT}; run "npm run build" first`);
      app.exit(1);
      return;
    }
    protocol.handle(APP_SCHEME, serveSite);
    buildMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => app.quit());
}
