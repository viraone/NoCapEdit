// "AI polish" for an Instagram caption (desktop app only), using Google's Gemini.
//
// A local config file, outside the project, says which file holds the key and which model to ask:
//   ~/.config/nocap-edit/gemini.json
//   { "apiKeyFile": "~/.config/nocap-edit/gemini_key", "model": "gemini-flash-latest" }
// Without that file, or with no key in the key file, the button does not appear. The key is read here and never reaches the page.
import { ipcMain } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppUrl } from "./lib/appUrl.mjs";
import { captionRequest, captionFromReply, parseGeminiConfig } from "./lib/captionAi.mjs";

const CONFIG_FILE = process.env.NOCAP_GEMINI_CONFIG ?? path.join(os.homedir(), ".config", "nocap-edit", "gemini.json");

async function loadConfig() {
  try {
    return parseGeminiConfig(await fsp.readFile(CONFIG_FILE, "utf8"), os.homedir());
  } catch {
    return null;
  }
}

/** @param {string} notes */
async function polish(notes) {
  const config = await loadConfig();
  if (!config) throw new Error("Gemini is not set up on this Mac.");
  let key;
  try {
    key = (await fsp.readFile(config.apiKeyFile, "utf8")).trim();
  } catch {
    throw new Error("The Gemini key file could not be read.");
  }
  if (!key) throw new Error("The Gemini key file is empty.");
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(captionRequest(notes)),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("Gemini did not answer. Check the internet connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : `status ${res.status}`;
    throw new Error(`Gemini refused the request: ${why}`);
  }
  const caption = captionFromReply(body);
  if (!caption) throw new Error("Gemini sent back no caption.");
  return caption;
}

export function registerCaptionAi() {
  /** @param {string} channel @param {(...args: any[]) => unknown} fn */
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (event, ...args) => {
      if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) throw new Error("not allowed");
      return fn(...args);
    });
  // Available only once there is a key to use, so the button never appears just to fail.
  handle("caption:info", async () => {
    const config = await loadConfig();
    if (!config) return { available: false };
    const key = await fsp.readFile(config.apiKeyFile, "utf8").catch(() => "");
    return key.trim() ? { available: true, model: config.model } : { available: false };
  });
  handle("caption:polish", (notes) => {
    if (typeof notes !== "string" || !notes.trim()) throw new Error("Write a few notes first.");
    return polish(notes.slice(0, 4000));
  });
}
