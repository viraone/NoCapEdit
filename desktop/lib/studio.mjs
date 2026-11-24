// Pure helpers for the "Mac Studio" model connection (desktop app only).
// The Studio serves an OpenAI-compatible API on the local network. The page reaches it through
// the shell at app://nocap/studio/v1/..., so the key stays in the shell and never enters the page.
import path from "node:path";

/** The page-side prefix the shell forwards. */
export const STUDIO_PREFIX = "/studio/v1/";

/**
 * Reads the local config file's text. Returns null when it is missing a piece or malformed.
 * @param {string} text contents of studio.json
 * @param {string} home the user's home folder, for "~/" in apiKeyFile
 * @returns {{ baseUrl: string, apiKeyFile: string, model: string, name: string } | null}
 */
export function parseStudioConfig(text, home) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { baseUrl, apiKeyFile, model, name } = /** @type {Record<string, unknown>} */ (raw);
  if (typeof baseUrl !== "string" || typeof apiKeyFile !== "string" || typeof model !== "string") return null;
  if (!model.trim() || !apiKeyFile.trim()) return null;
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const keyFile = apiKeyFile.startsWith("~/") ? path.join(home, apiKeyFile.slice(2)) : apiKeyFile;
  if (!path.isAbsolute(keyFile)) return null;
  return {
    baseUrl: `${url.origin}${url.pathname.replace(/\/+$/, "")}`,
    apiKeyFile: keyFile,
    model: model.trim(),
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : "Mac Studio",
  };
}

/**
 * The upstream path for a page request, or null when it is not one the shell forwards.
 * Only the two calls the editor makes are allowed: list models, and chat completions.
 * @param {string} pathname e.g. "/studio/v1/chat/completions"
 * @param {string} method
 * @returns {string | null} e.g. "/chat/completions"
 */
export function studioUpstreamPath(pathname, method) {
  if (pathname === `${STUDIO_PREFIX}models` && method === "GET") return "/models";
  if (pathname === `${STUDIO_PREFIX}chat/completions` && method === "POST") return "/chat/completions";
  return null;
}

/**
 * The address to connect to, from the output of `dscacheutil -q host -a name <host>`.
 * IPv4 first; otherwise an IPv6 address that is not link-local (fe80:, which needs a network
 * interface name to be usable). Null when the output has neither.
 * @param {string} text
 * @returns {string | null}
 */
export function addressFromDscacheutil(text) {
  const v4 = text.match(/^ip_address:\s*(\d{1,3}(?:\.\d{1,3}){3})\s*$/m);
  if (v4) return v4[1];
  for (const m of text.matchAll(/^ipv6_address:\s*([0-9a-f:]+)\s*$/gim)) {
    if (!/^fe80:/i.test(m[1])) return m[1];
  }
  return null;
}

/**
 * True when the host in a base URL is a name that must be looked up (not already an address).
 * @param {string} hostname as given by URL.hostname
 * @returns {boolean}
 */
export function needsLookup(hostname) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return false;
  if (hostname.startsWith("[")) return false;
  return /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i.test(hostname);
}
