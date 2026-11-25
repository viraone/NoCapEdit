// Pure helpers for the "AI polish" caption button (desktop/captionAi.mjs runs the request).
import path from "node:path";

/**
 * Reads the local config file's text. Returns null when it is missing a piece or malformed.
 * @param {string} text contents of gemini.json
 * @param {string} home the user's home folder, for "~/" in apiKeyFile
 * @returns {{ apiKeyFile: string, model: string } | null}
 */
export function parseGeminiConfig(text, home) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const { apiKeyFile, model } = /** @type {Record<string, unknown>} */ (raw);
  if (typeof apiKeyFile !== "string" || !apiKeyFile.trim()) return null;
  const file = apiKeyFile.startsWith("~/") ? path.join(home, apiKeyFile.slice(2)) : apiKeyFile;
  if (!path.isAbsolute(file)) return null;
  const name = typeof model === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(model.trim()) ? model.trim() : "gemini-flash-latest";
  return { apiKeyFile: file, model: name };
}

const INSTRUCTIONS = [
  "You write Instagram captions for a comedy show's account.",
  "The user gives rough notes (date, place, who, what happened). Turn them into one finished caption.",
  "Rules: keep every fact from the notes and add none; friendly and short (under 80 words); a first line that hooks;",
  "line breaks between ideas; 4 to 8 relevant hashtags on the last line; keep any @handles exactly as written.",
  "Use plain keyboard characters only: no emoji, no curly quotes, no long dashes.",
  "Reply with the caption text only, no preamble and no quotation marks around it.",
].join(" ");

/**
 * The request body for Gemini's generateContent call.
 * @param {string} notes
 */
export function captionRequest(notes) {
  return {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ text: `Notes:\n${notes.trim()}` }] }],
    generationConfig: { temperature: 0.7, maxOutputTokens: 2000 },
  };
}

/**
 * The caption in Gemini's reply, or "" when there is none.
 * @param {unknown} reply
 * @returns {string}
 */
export function captionFromReply(reply) {
  const parts = /** @type {{ candidates?: { content?: { parts?: { text?: unknown }[] } }[] } | null} */ (reply)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  return text
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
}
