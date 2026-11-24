import path from "node:path";

export const APP_SCHEME = "app";
export const APP_HOST = "nocap";
export const APP_ORIGIN = "app://nocap";

/**
 * The three cross-origin isolation headers, a fresh object each call.
 * @returns {{ "Cross-Origin-Opener-Policy": string, "Cross-Origin-Embedder-Policy": string, "Cross-Origin-Resource-Policy": string }}
 */
export function isolationHeaders() {
  return {
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
}

/**
 * @param {string} file
 * @returns {string}
 */
export function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html";
    case ".js":
    case ".mjs":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".wasm":
      return "application/wasm";
    case ".json":
      return "application/json";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".woff2":
      return "font/woff2";
    case ".txt":
      return "text/plain";
    case ".cube":
      return "text/plain";
    case ".ico":
      return "image/x-icon";
    case ".webmanifest":
      return "application/manifest+json";
    case ".mp4":
      return "video/mp4";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".webp":
      return "image/webp";
    case ".lottie":
      return "application/zip";
    default:
      return "application/octet-stream";
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isAppUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "app:" && parsed.hostname === "nocap";
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isExternalUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

/**
 * @param {string} root
 * @param {string} url
 * @returns {string[]}
 */
export function fileCandidates(root, url) {
  if (!isAppUrl(url)) return [];

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return [];
  }

  if (pathname.includes("\0")) return [];

  const base = path.join(root, pathname);
  const cleanRoot = path.resolve(root);
  const resolvedBase = path.resolve(base);

  if (resolvedBase !== cleanRoot && !resolvedBase.startsWith(cleanRoot + path.sep)) {
    return [];
  }

  if (pathname.endsWith("/")) {
    return [path.join(base, "index.html")];
  }

  return [base, base + ".html", path.join(base, "index.html")];
}
