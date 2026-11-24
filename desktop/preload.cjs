// The fixed list of things the page may ask the desktop shell for (docs/DESKTOP_PLAN.md).
// CommonJS on purpose: a sandboxed preload cannot be an ES module.
//
// ffmpeg: the real ffmpeg program, run by the shell inside a private temporary work folder
// (desktop/ffmpegHost.mjs). The page can put bytes into that folder, run a command there and read
// files back out. It cannot name any other place on disk.
const { contextBridge, ipcRenderer } = require("electron");

/** @type {Map<string, (line: string) => void>} */
const logListeners = new Map();
ipcRenderer.on("ffmpeg:log", (_event, id, line) => {
  const fn = logListeners.get(id);
  if (fn) fn(line);
});

contextBridge.exposeInMainWorld("nocapDesktop", {
  isDesktop: true,
  ffmpeg: {
    info: () => ipcRenderer.invoke("ffmpeg:info"),
    open: () => ipcRenderer.invoke("ffmpeg:open"),
    close: (id) => {
      logListeners.delete(id);
      return ipcRenderer.invoke("ffmpeg:close", id);
    },
    write: (id, name, data, append) => ipcRenderer.invoke("ffmpeg:write", id, name, data, !!append),
    read: (id, name) => ipcRenderer.invoke("ffmpeg:read", id, name),
    mkdir: (id, name) => ipcRenderer.invoke("ffmpeg:mkdir", id, name),
    remove: (id, name) => ipcRenderer.invoke("ffmpeg:remove", id, name),
    exec: (id, args) => ipcRenderer.invoke("ffmpeg:exec", id, args),
    onLog: (id, fn) => {
      if (typeof fn === "function") logListeners.set(id, fn);
      else logListeners.delete(id);
    },
  },
});
