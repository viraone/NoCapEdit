export const EXPORT_EXTENSIONS = [".mp4", ".webm", ".mov", ".gif", ".png", ".srt", ".vtt", ".txt", ".zip"];

/**
 * @param {unknown} name
 * @returns {string | null}
 */
export function safeExportName(name) {
  if (typeof name !== "string") return null;
  if (name.length > 200) return null;
  if (name.includes("/") || name.includes("\\")) return null;
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 32 || code === 127) return null;
  }
  if (name.startsWith(".")) return null;
  if (name.startsWith(" ") || name.endsWith(" ")) return null;

  const lower = name.toLowerCase();
  let matchedExt = null;
  for (const ext of EXPORT_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      matchedExt = ext;
      break;
    }
  }
  if (!matchedExt) return null;

  const stem = name.slice(0, name.length - matchedExt.length);
  if (stem.length < 1) return null;

  return name;
}

/**
 * @param {string} name
 * @param {number} n
 * @returns {string}
 */
export function numberedName(name, n) {
  if (n <= 1) return name;
  const lastDot = name.lastIndexOf(".");
  if (lastDot === -1) {
    return `${name} (${n})`;
  }
  const stem = name.slice(0, lastDot);
  const ext = name.slice(lastDot);
  return `${stem} (${n})${ext}`;
}

/**
 * @param {string} name
 * @param {string} id
 * @returns {string}
 */
export function partName(name, id) {
  return `.${name}.${id}.part`;
}
