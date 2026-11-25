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

// The Android emulator (desktop/phoneHost.mjs). One listener each for the screen's video and for
// the progress of the Instagram steps.
/** @type {((chunk: Uint8Array | null) => void) | null} */
let onPhoneVideo = null;
/** @type {((label: string) => void) | null} */
let onPhoneStep = null;
ipcRenderer.on("phone:video", (_event, chunk) => {
  if (onPhoneVideo) onPhoneVideo(chunk);
});
ipcRenderer.on("phone:step", (_event, label) => {
  if (onPhoneStep) onPhoneStep(label);
});

contextBridge.exposeInMainWorld("nocapDesktop", {
  isDesktop: true,
  // The Mac Studio model connection (desktop/studioProxy.mjs): only "is it set up, and which model".
  studio: { info: () => ipcRenderer.invoke("studio:info") },
  phone: {
    info: () => ipcRenderer.invoke("phone:info"),
    begin: () => ipcRenderer.invoke("phone:begin"),
    write: (id, data) => ipcRenderer.invoke("phone:write", id, data),
    send: (id, name) => ipcRenderer.invoke("phone:send", id, name),
    screen: (on) => ipcRenderer.invoke("phone:screen", !!on),
    onVideo: (fn) => {
      onPhoneVideo = typeof fn === "function" ? fn : null;
    },
    input: (action) => ipcRenderer.invoke("phone:input", action),
    open: (mode, uri) => ipcRenderer.invoke("phone:open", mode, uri),
    instagramHome: () => ipcRenderer.invoke("phone:instagramHome"),
    reel: (uri, options) => ipcRenderer.invoke("phone:reel", uri, options),
    story: (uri, options) => ipcRenderer.invoke("phone:story", uri, options),
    shareStory: (audience) => ipcRenderer.invoke("phone:shareStory", audience),
    onStep: (fn) => {
      onPhoneStep = typeof fn === "function" ? fn : null;
    },
    cancel: () => ipcRenderer.invoke("phone:cancel"),
    share: () => ipcRenderer.invoke("phone:share"),
  },
  // "AI polish" for a caption (desktop/captionAi.mjs): the key stays in the shell.
  caption: {
    info: () => ipcRenderer.invoke("caption:info"),
    polish: (notes) => ipcRenderer.invoke("caption:polish", notes),
  },
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
