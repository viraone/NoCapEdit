// "Mac Studio" model connection for the page (desktop app only).
//
// A local config file, outside the project, says where the Studio is, which model to ask for and
// which file holds its key:  ~/.config/nocap-edit/studio.json
//   { "baseUrl": "http://<host>:<port>/v1", "apiKeyFile": "~/...", "model": "<model id>", "name": "Mac Studio" }
// Without that file the feature is simply absent. The page calls app://nocap/studio/v1/... and the
// shell forwards the two allowed calls with the key added, so the key never reaches the page.
import { ipcMain } from "electron";
import { execFile } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isAppUrl, isolationHeaders } from "./lib/appUrl.mjs";
import { addressFromDscacheutil, needsLookup, parseStudioConfig, STUDIO_PREFIX, studioUpstreamPath } from "./lib/studio.mjs";

const CONFIG_FILE = process.env.NOCAP_STUDIO_CONFIG ?? path.join(os.homedir(), ".config", "nocap-edit", "studio.json");

/** Read fresh each time: the file is tiny, and editing it should not need an app restart. */
async function loadConfig() {
  try {
    return parseStudioConfig(await fsp.readFile(CONFIG_FILE, "utf8"), os.homedir());
  } catch {
    return null;
  }
}

/** @type {Map<string, { url: string, at: number }>} */
const resolved = new Map();

/**
 * The base URL with its host name replaced by an address.
 * Inside this app, looking up a ".local" name the normal way never answers (measured on macOS
 * 26.6: getaddrinfo hangs in Electron, while connecting by address works). The system's own
 * lookup tool, started from here, answers at once, so the name is resolved with that.
 * @param {string} baseUrl
 * @returns {Promise<string>}
 */
async function withAddress(baseUrl) {
  const url = new URL(baseUrl);
  if (!needsLookup(url.hostname)) return baseUrl;
  const hit = resolved.get(baseUrl);
  if (hit && Date.now() - hit.at < 60_000) return hit.url;
  const text = await new Promise((resolve) => {
    execFile("/usr/bin/dscacheutil", ["-q", "host", "-a", "name", url.hostname], { timeout: 5000 }, (err, stdout) => resolve(err ? "" : String(stdout)));
  });
  const address = addressFromDscacheutil(/** @type {string} */ (text));
  if (!address) return baseUrl;
  url.hostname = address.includes(":") ? `[${address}]` : address;
  const out = url.toString().replace(/\/+$/, "");
  resolved.set(baseUrl, { url: out, at: Date.now() });
  return out;
}

const json = (/** @type {number} */ status, /** @type {unknown} */ body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...isolationHeaders() } });

/** @param {string} pathname */
export function isStudioRequest(pathname) {
  return pathname.startsWith(STUDIO_PREFIX);
}

/**
 * Forwards an allowed call to the Studio with its key. Everything else gets a 404.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
export async function handleStudioRequest(request) {
  const upstream = studioUpstreamPath(new URL(request.url).pathname, request.method);
  if (!upstream) return json(404, { error: { message: "not found" } });
  const config = await loadConfig();
  if (!config) return json(503, { error: { message: "The Mac Studio connection is not set up on this Mac." } });
  let key;
  try {
    key = (await fsp.readFile(config.apiKeyFile, "utf8")).trim();
  } catch {
    return json(503, { error: { message: "The Mac Studio key file could not be read." } });
  }
  try {
    const res = await fetch(`${await withAddress(config.baseUrl)}${upstream}`, {
      method: request.method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: request.method === "POST" ? await request.text() : undefined,
      signal: request.signal,
    });
    // Pass the answer through, with the headers every app:// response needs.
    return new Response(res.body, {
      status: res.status,
      headers: { "Content-Type": res.headers.get("content-type") ?? "application/json", "Cache-Control": "no-store", ...isolationHeaders() },
    });
  } catch (err) {
    console.error("[studio] request failed:", err instanceof Error ? `${err.message} ${/** @type {{ cause?: { code?: string } }} */ (err).cause?.code ?? ""}` : err);
    return json(502, { error: { message: "The Mac Studio did not answer. Is it on and on this network?" } });
  }
}

export function registerStudio() {
  ipcMain.handle("studio:info", async (event) => {
    if (!event.senderFrame || !isAppUrl(event.senderFrame.url)) throw new Error("not allowed");
    const config = await loadConfig();
    return config ? { available: true, model: config.model, name: config.name } : { available: false };
  });
}
