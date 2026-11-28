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

// Scheduled Stories (desktop/scheduleHost.mjs). One listener each; a "show" that arrives before the
// page listens is kept until it does.
/** @type {((state: unknown) => void) | null} */
let onScheduleChange = null;
/** @type {(() => void) | null} */
let onScheduleShow = null;
let scheduleShowWaiting = false;
ipcRenderer.on("schedule:changed", (_event, state) => {
  if (onScheduleChange) onScheduleChange(state);
});
ipcRenderer.on("schedule:show", () => {
  if (onScheduleShow) onScheduleShow();
  else scheduleShowWaiting = true;
});

contextBridge.exposeInMainWorld("nocapDesktop", {
  isDesktop: true,
  // The queue of Stories to post later. The page names no path: files are picked in the Mac's own window.
  schedule: {
    state: () => ipcRenderer.invoke("schedule:state"),
    pick: () => ipcRenderer.invoke("schedule:pick"),
    discard: (draftId) => ipcRenderer.invoke("schedule:discard", draftId),
    add: (draftId, wanted) => ipcRenderer.invoke("schedule:add", draftId, wanted),
    change: (id, wanted) => ipcRenderer.invoke("schedule:change", id, wanted),
    remove: (id) => ipcRenderer.invoke("schedule:remove", id),
    postNow: (id) => ipcRenderer.invoke("schedule:postNow", id),
    postpone: (id) => ipcRenderer.invoke("schedule:postpone", id),
    setPaused: (paused) => ipcRenderer.invoke("schedule:pause", !!paused),
    stop: () => ipcRenderer.invoke("schedule:stop"),
    hold: (id) => ipcRenderer.invoke("schedule:hold", id),
    release: (id) => ipcRenderer.invoke("schedule:release", id),
    onChange: (fn) => {
      onScheduleChange = typeof fn === "function" ? fn : null;
    },
    onShow: (fn) => {
      onScheduleShow = typeof fn === "function" ? fn : null;
      if (onScheduleShow && scheduleShowWaiting) {
        scheduleShowWaiting = false;
        onScheduleShow();
      }
    },
  },
  // The Mac Studio model connection (desktop/studioProxy.mjs): only "is it set up, and which model".
  studio: { info: () => ipcRenderer.invoke("studio:info") },
  phone: {
    info: () => ipcRenderer.invoke("phone:info"),
    launch: (avd) => ipcRenderer.invoke("phone:launch", typeof avd === "string" ? avd : null),
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
    highlight: (name, maxAgeMinutes) => ipcRenderer.invoke("phone:highlight", name, maxAgeMinutes),
    highlightCover: (name, jpeg) => ipcRenderer.invoke("phone:highlightCover", name, jpeg),
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
    cover: (frames) => ipcRenderer.invoke("caption:cover", frames),
    style: (look) => ipcRenderer.invoke("caption:style", look),
  },
  // Exports saved straight into a folder the user picked (desktop/exportFolderHost.mjs). The page
  // gives a file name, never a path; the folder comes from the Mac's own folder window.
  exportFolder: {
    info: () => ipcRenderer.invoke("exportFolder:info"),
    choose: () => ipcRenderer.invoke("exportFolder:choose"),
    clear: () => ipcRenderer.invoke("exportFolder:clear"),
    open: (name) => ipcRenderer.invoke("exportFolder:open", name),
    write: (id, data) => ipcRenderer.invoke("exportFolder:write", id, data),
    reset: (id) => ipcRenderer.invoke("exportFolder:reset", id),
    close: (id) => ipcRenderer.invoke("exportFolder:close", id),
    read: (id) => ipcRenderer.invoke("exportFolder:read", id),
    abort: (id) => ipcRenderer.invoke("exportFolder:abort", id),
    reveal: (id) => ipcRenderer.invoke("exportFolder:reveal", id),
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
