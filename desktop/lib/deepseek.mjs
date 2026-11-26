// Pure helpers to send a Gemini-shaped request to DeepSeek's OpenAI-compatible chat API.
import path from "node:path";

/**
 * Reads the local config file's text. Returns null when it is missing a piece or malformed.
 * @param {string} text contents of deepseek.json
 * @param {string} home the user's home folder, for "~/" in apiKeyFile
 * @returns {{ apiKeyFile: string, model: string } | null}
 */
export function parseDeepseekConfig(text, home) {
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
  const name = typeof model === "string" && /^[A-Za-z0-9._-]{1,80}$/.test(model.trim()) ? model.trim() : "deepseek-flash";
  return { apiKeyFile: file, model: name };
}

/**
 * The API key from the text of a key file, or "".
 * @param {string} text
 * @returns {string}
 */
export function keyFromFile(text) {
  const lines = text.split(/\r?\n/);
  let key = "";

  // First pass: look for DEEPSEEK_API_KEY
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const dsMatch = trimmed.match(/^(?:export\s+)?DEEPSEEK_API_KEY\s*=\s*(.*)$/);
    if (dsMatch) {
      key = dsMatch[1];
      break;
    }
  }

  // Second pass: look for ANTHROPIC_AUTH_TOKEN if DEEPSEEK_API_KEY was not found
  if (!key) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) continue;
      const anMatch = trimmed.match(/^(?:export\s+)?ANTHROPIC_AUTH_TOKEN\s*=\s*(.*)$/);
      if (anMatch) {
        key = anMatch[1];
        break;
      }
    }
  }

  if (!key) {
    const whole = text.trim();
    if (whole && !whole.includes(" ") && !whole.includes("\n") && !whole.includes("=")) {
      key = whole;
    }
  }

  // Strip surrounding quotes
  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  } else if (key.startsWith("'") && key.endsWith("'")) {
    key = key.slice(1, -1);
  }

  if (!/^[A-Za-z0-9._-]{8,200}$/.test(key)) return "";
  return key;
}

/**
 * Converts a Gemini generateContent body into a DeepSeek chat completion request.
 * @param {any} gemini
 * @param {string} model
 * @returns {any}
 */
export function toDeepseekRequest(gemini, model) {
  const systemParts = gemini.systemInstruction?.parts || [];
  const systemContent = systemParts.map((/** @type {any} */ p) => p.text || "").join("\n");

  const contents = gemini.contents || [];
  let allText = true;
  for (const c of contents) {
    for (const p of c.parts || []) {
      if (p.inlineData) {
        allText = false;
        break;
      }
    }
    if (!allText) break;
  }

  let userContent;
  if (allText) {
    const texts = [];
    for (const c of contents) {
      for (const p of c.parts || []) {
        if (p.text) texts.push(p.text);
      }
    }
    userContent = texts.join("\n");
  } else {
    const arr = [];
    for (const c of contents) {
      for (const p of c.parts || []) {
        if (p.text) {
          arr.push({ type: "text", text: p.text });
        } else if (p.inlineData) {
          arr.push({
            type: "image_url",
            image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
          });
        }
      }
    }
    userContent = arr;
  }

  const gen = gemini.generationConfig || {};
  const req = {
    model,
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: userContent },
    ],
    temperature: gen.temperature ?? 0.7,
    max_tokens: gen.maxOutputTokens ?? 2000,
    thinking: { type: "disabled" },
  };

  if (gen.responseMimeType === "application/json") {
    req.response_format = { type: "json_object" };
  }

  return req;
}

/**
 * Turns a chat completion reply into a Gemini-shaped reply.
 * @param {any} reply
 * @returns {any}
 */
export function asGeminiReply(reply) {
  const content = reply?.choices?.[0]?.message?.content;
  if (typeof content !== "string") return {};
  return {
    candidates: [
      {
        content: {
          parts: [{ text: content }],
        },
      },
    ],
  };
}
