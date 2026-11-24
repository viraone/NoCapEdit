// The fixed list of things the page may ask the desktop shell for (docs/DESKTOP_PLAN.md).
// Nothing yet beyond "you are running in the desktop app"; it grows in steps 5 and 6.
// CommonJS on purpose: a sandboxed preload cannot be an ES module.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("nocapDesktop", { isDesktop: true });
