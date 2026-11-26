/**
 * Pure helpers for the Instagram Highlight cover feature: validating frames,
 * building the Gemini request, and parsing the model's reply.
 */

const INSTRUCTIONS = [
  "You choose the cover picture for an Instagram Highlight of a comedy show's account.",
  "The cover is shown as a very small circle cut from a square.",
  "From the numbered video frames, pick the one that is easiest to recognise at that size: bright, sharp, a clear subject such as faces or large title text.",
  "Never pick a black, blurry or half-faded frame when there is a better one.",
  "center says where along the frame's longer side the middle of the square crop should be, from 0 (top or left) to 1 (bottom or right), so the main subject ends up inside the circle.",
  'Reply with JSON only: {"frame": <number>, "center": <number>}.',
].join(" ");

/**
 * True only when `frames` is an array of 1..10 entries, each a non-empty string
 * of at most 600000 characters matching `/^[A-Za-z0-9+/]+={0,2}$/`.
 * @param {unknown} frames
 * @returns {boolean}
 */
export function validCoverFrames(frames) {
  if (!Array.isArray(frames)) return false;
  if (frames.length < 1 || frames.length > 10) return false;
  const re = /^[A-Za-z0-9+/]+={0,2}$/;
  for (const f of frames) {
    if (typeof f !== "string") return false;
    if (f.length === 0 || f.length > 600000) return false;
    if (!re.test(f)) return false;
  }
  return true;
}

/**
 * The request body for Gemini generateContent.
 * @param {string[]} frames base64 JPEG strings
 * @returns {{ systemInstruction: { parts: { text: string }[] }, contents: { role: string, parts: any[] }[], generationConfig: { temperature: number, maxOutputTokens: number, responseMimeType: string } }}
 */
export function coverRequest(frames) {
  /** @type {Array<{ text: string } | { inlineData: { mimeType: string, data: string } }>} */
  const parts = [];
  for (let i = 0; i < frames.length; i++) {
    parts.push({ text: `Frame ${i + 1}` });
    parts.push({ inlineData: { mimeType: "image/jpeg", data: frames[i] } });
  }
  return {
    systemInstruction: { parts: [{ text: INSTRUCTIONS }] },
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2000, responseMimeType: "application/json" },
  };
}

/**
 * Parse the model's reply into `{ frame, center }` or null.
 * `frame` in the reply is 1-based; the returned `frame` is 0-based.
 * @param {unknown} reply
 * @param {number} count number of frames sent
 * @returns {{ frame: number, center: number } | null}
 */
export function coverFromReply(reply, count) {
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
  const rawFrame = obj.frame;
  if (typeof rawFrame !== "number" || !Number.isInteger(rawFrame) || rawFrame < 1 || rawFrame > count) return null;
  const frame = rawFrame - 1;
  let center = obj.center;
  if (typeof center !== "number" || !Number.isFinite(center)) {
    center = 0.5;
  } else {
    center = Math.max(0, Math.min(1, center));
  }
  return { frame, center };
}
