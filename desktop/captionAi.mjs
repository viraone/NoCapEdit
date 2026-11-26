// Google's Gemini, for the desktop app only: "AI polish" for an Instagram caption, and picking a
// Highlight's cover from a few frames of the video (the frames are sent only when that switch is on).
//
// A local config file, outside the project, says which file holds the key and which model to ask:
//   ~/.config/nocap-edit/gemini.json
//   { "apiKeyFile": "~/.config/nocap-edit/gemini_key", "model": "gemini-flash-latest" }
// Without that file, or with no key in the key file, the button does not appear. The key is read here and never reaches the page.
//
// DeepSeek can stand in when Gemini is too busy to answer (the same two jobs, so the notes or frames go
// there instead). It is on only with its own config file, ~/.config/nocap-edit/deepseek.json:
//   { "apiKeyFile": "~/path/to/key-or-env-file", "model": "deepseek-flash" }
import { ipcMain } from "electron";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppUrl } from "./lib/appUrl.mjs";
import { captionRequest, captionFromReply, parseGeminiConfig } from "./lib/captionAi.mjs";
import { coverFromReply, coverRequest, validCoverFrames } from "./lib/coverAi.mjs";
import { asGeminiReply, keyFromFile, parseDeepseekConfig, toDeepseekRequest } from "./lib/deepseek.mjs";

const CONFIG_FILE = process.env.NOCAP_GEMINI_CONFIG ?? path.join(os.homedir(), ".config", "nocap-edit", "gemini.json");

const DEEPSEEK_CONFIG_FILE = process.env.NOCAP_DEEPSEEK_CONFIG ?? path.join(os.homedir(), ".config", "nocap-edit", "deepseek.json");

/** The stand-in, when it is set up and has a key. */
async function loadSpare() {
  try {
    const config = parseDeepseekConfig(await fsp.readFile(DEEPSEEK_CONFIG_FILE, "utf8"), os.homedir());
    if (!config) return null;
    const key = keyFromFile(await fsp.readFile(config.apiKeyFile, "utf8"));
    return key ? { key, model: config.model } : null;
  } catch {
    return null;
  }
}

async function loadConfig() {
  try {
    return parseGeminiConfig(await fsp.readFile(CONFIG_FILE, "utf8"), os.homedir());
  } catch {
    return null;
  }
}

/** A lighter model that answers when the usual one is too busy to. */
const SPARE_MODEL = "gemini-flash-lite-latest";

/** Gemini could not take the request just now (busy, over its limit, or silent): worth asking elsewhere. */
class Busy extends Error {}

/**
 * Sends one request to a model and returns Gemini's reply: the model in the config file unless
 * another is named.
 * @param {unknown} request
 * @param {{ model?: string, timeout?: number }} [opts]
 */
async function ask(request, opts = {}) {
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
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(opts.model ?? config.model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(opts.timeout ?? 45_000),
    });
  } catch {
    throw new Busy("Gemini did not answer. Check the internet connection.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : `status ${res.status}`;
    const Kind = res.status === 429 || res.status >= 500 ? Busy : Error;
    throw new Kind(`Gemini refused the request: ${why}`);
  }
  return body;
}

/**
 * Sends a request to DeepSeek and returns its answer in the shape Gemini's takes.
 * @param {{ key: string, model: string }} spare
 * @param {unknown} request
 */
async function askDeepseek(spare, request) {
  let res;
  try {
    res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${spare.key}` },
      body: JSON.stringify(toDeepseekRequest(request, spare.model)),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    throw new Error("DeepSeek did not answer.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = typeof body?.error?.message === "string" ? body.error.message.slice(0, 200) : `status ${res.status}`;
    throw new Error(`DeepSeek refused the request: ${why}`);
  }
  return asGeminiReply(body);
}

/**
 * Asks Gemini; when it is too busy to answer, asks DeepSeek if that is set up, else the lighter
 * Gemini model when the caller allows it.
 * @param {unknown} request
 * @param {{ lighter?: boolean }} [opts]
 * @returns {Promise<{ reply: unknown, by: "Gemini" | "DeepSeek" }>}
 */
async function answer(request, opts = {}) {
  const spare = await loadSpare();
  try {
    // With somewhere else to go, a silent Gemini is given up on sooner.
    return { reply: await ask(request, { timeout: spare || opts.lighter ? 30_000 : 45_000 }), by: "Gemini" };
  } catch (e) {
    if (!(e instanceof Busy)) throw e;
    if (spare) {
      const reply = await askDeepseek(spare, request).catch((d) => {
        throw new Error(`${e.message} ${d.message}`);
      });
      return { reply, by: "DeepSeek" };
    }
    if (opts.lighter) return { reply: await ask(request, { model: SPARE_MODEL }), by: "Gemini" };
    throw e;
  }
}

/** @param {string} notes */
async function polish(notes) {
  const { reply, by } = await answer(captionRequest(notes));
  const caption = captionFromReply(reply);
  if (!caption) throw new Error(`${by} sent back no caption.`);
  return caption;
}

/** @param {string[]} frames base64 JPEGs of moments in the video */
async function pickCover(frames) {
  const { reply, by } = await answer(coverRequest(frames), { lighter: true });
  const pick = coverFromReply(reply, frames.length);
  if (!pick) throw new Error(`${by} did not pick a frame.`);
  return { ...pick, by };
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
    return key.trim() ? { available: true, model: config.model, spare: !!(await loadSpare()) } : { available: false };
  });
  handle("caption:polish", (notes) => {
    if (typeof notes !== "string" || !notes.trim()) throw new Error("Write a few notes first.");
    return polish(notes.slice(0, 4000));
  });
  handle("caption:cover", (frames) => {
    if (!validCoverFrames(frames)) throw new Error("The video's frames could not be used.");
    return pickCover(/** @type {string[]} */ (frames));
  });
}
