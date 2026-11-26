/**
 * Pure helpers for the Instagram Story text style feature: validating the ask,
 * building the Gemini request, and parsing the model's reply.
 */

export const STYLE_FONTS = ["inter", "montserrat", "bangers", "playfair", "bebas", "courier", "marker", "grotesk"];

const INSTRUCTIONS = [
  "You design the look of one short line of text on an Instagram Story.",
  "The picture is one frame of the video.",
  "The text will sit at the given place (top, middle or bottom) and must be easy to read against what is there.",
  "Match the mood and colours of the picture.",
  "Do not change or repeat the words.",
  `Reply with JSON only: {"name": short name of the look (max 40 chars), "why": one short sentence (max 120 chars), "font": one of ${STYLE_FONTS.join(", ")}, "color": "#rrggbb", "background": "#rrggbb" or null, "size": number from 0.035 to 0.09 (fraction of picture height), "bold": boolean, "italic": boolean}.`,
].join(" ");

/**
 * True only when `ask` is an object with valid words, slot, frame, and previous.
 * @param {unknown} ask
 * @returns {boolean}
 */
export function validStyleAsk(ask) {
  if (!ask || typeof ask !== "object" || Array.isArray(ask)) return false;
  const a = /** @type {any} */ (ask);

  if (typeof a.words !== "string") return false;
  const trimmedWords = a.words.trim();
  if (trimmedWords.length < 1 || trimmedWords.length > 200) return false;

  if (a.slot !== "top" && a.slot !== "middle" && a.slot !== "bottom") return false;

  if (typeof a.frame !== "string") return false;
  if (a.frame.length < 1 || a.frame.length > 600000) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(a.frame)) return false;

  if (!Array.isArray(a.previous)) return false;
  if (a.previous.length > 12) return false;
  for (const p of a.previous) {
    if (typeof p !== "string") return false;
    if (p.length > 80) return false;
  }

  return true;
}

/**
 * The request body for Gemini generateContent.
 * @param {{ words: string, slot: string, frame: string, previous: string[] }} ask
 * @returns {{ systemInstruction: { parts: { text: string }[] }, contents: { role: string, parts: any[] }[], generationConfig: { temperature: number, maxOutputTokens: number, responseMimeType: string } }}
 */
export function styleRequest(ask) {
  let userText = `Words: "${ask.words}"\nPlace: ${ask.slot}`;
  if (ask.previous && ask.previous.length > 0) {
    userText += `\nLooks already tried, choose something clearly different: ${ask.previous.join("; ")}`;
  }

  return {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts: [{ text: userText }, { inlineData: { mimeType: "image/jpeg", data: ask.frame } }] }],
    generationConfig: { temperature: 0.9, maxOutputTokens: 2000, responseMimeType: "application/json" },
  };
}

/**
 * Calculate WCAG contrast ratio between two hex colors.
 * @param {string} a hex color #rrggbb
 * @param {string} b hex color #rrggbb
 * @returns {number} contrast ratio 1..21
 */
export function contrast(a, b) {
  const lum = (hex) => {
    const rgb = hex.match(/[0-9a-fA-F]{2}/g);
    if (!rgb) return 0;
    const [r, g, b] = rgb.map((c) => {
      let v = parseInt(c, 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(a);
  const l2 = lum(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Parse the model's reply into a style object or null.
 * @param {unknown} reply
 * @returns {{ name: string, why: string, font: string, color: string, background: string | null, size: number, bold: boolean, italic: boolean } | null}
 */
export function styleFromReply(reply) {
  const parts = reply?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  let text = parts.map((p) => p?.text ?? "").join("").trim();
  // Remove leading ``` or ```json fence
  text = text.replace(/^```(?:json)?\s*/, "");
  // Remove trailing ``` fence
  text = text.replace(/\s*```$/, "");
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return null;

  const font = obj.font;
  if (typeof font !== "string" || !STYLE_FONTS.includes(font)) return null;

  let color = obj.color;
  if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  color = color.toLowerCase();

  let background = obj.background;
  if (typeof background === "string" && /^#[0-9a-fA-F]{6}$/.test(background)) {
    background = background.toLowerCase();
  } else {
    background = null;
  }

  let size = obj.size;
  if (typeof size !== "number" || !Number.isFinite(size)) {
    size = 0.055;
  } else {
    size = Math.max(0.035, Math.min(0.09, size));
  }

  const bold = obj.bold === true;
  const italic = obj.italic === true;

  let name = obj.name;
  if (typeof name !== "string") {
    name = "New look";
  } else {
    name = name.trim().slice(0, 40);
  }

  let why = obj.why;
  if (typeof why !== "string") {
    why = "";
  } else {
    why = why.trim().slice(0, 120);
  }

  if (background !== null && contrast(color, background) < 3) {
    const cWhite = contrast("#ffffff", background);
    const cBlack = contrast("#000000", background);
    color = cWhite > cBlack ? "#ffffff" : "#000000";
  }

  return { name, why, font, color, background, size, bold, italic };
}
