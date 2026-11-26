import { describe, expect, it } from "vitest";
import { validStyleAsk, styleRequest, styleFromReply, contrast } from "../../desktop/lib/styleAi.mjs";

describe("validStyleAsk", () => {
  const baseAsk = {
    words: "Hello",
    slot: "top",
    frame: "abc",
    previous: [],
  };

  it("accepts valid ask", () => {
    expect(validStyleAsk(baseAsk)).toBe(true);
  });

  it("rejects non-object", () => {
    expect(validStyleAsk(null)).toBe(false);
    expect(validStyleAsk("string")).toBe(false);
    expect(validStyleAsk([])).toBe(false);
  });

  it("rejects invalid words", () => {
    expect(validStyleAsk({ ...baseAsk, words: "" })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, words: "   " })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, words: "a".repeat(201) })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, words: 123 })).toBe(false);
  });

  it("accepts words with length 1..200", () => {
    expect(validStyleAsk({ ...baseAsk, words: "a" })).toBe(true);
    expect(validStyleAsk({ ...baseAsk, words: "a".repeat(200) })).toBe(true);
  });

  it("rejects invalid slot", () => {
    expect(validStyleAsk({ ...baseAsk, slot: "left" })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, slot: "" })).toBe(false);
  });

  it("rejects invalid frame", () => {
    expect(validStyleAsk({ ...baseAsk, frame: "" })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, frame: "abc!" })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, frame: "a".repeat(600001) })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, frame: 123 })).toBe(false);
  });

  it("accepts valid frame", () => {
    expect(validStyleAsk({ ...baseAsk, frame: "a".repeat(600000) })).toBe(true);
  });

  it("rejects invalid previous", () => {
    expect(validStyleAsk({ ...baseAsk, previous: "not array" })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, previous: Array(13).fill("a") })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, previous: ["a".repeat(81)] })).toBe(false);
    expect(validStyleAsk({ ...baseAsk, previous: [123] })).toBe(false);
  });

  it("accepts valid previous", () => {
    expect(validStyleAsk({ ...baseAsk, previous: Array(12).fill("a") })).toBe(true);
    expect(validStyleAsk({ ...baseAsk, previous: ["a".repeat(80)] })).toBe(true);
  });
});

describe("styleRequest", () => {
  const ask = {
    words: "Test",
    slot: "middle",
    frame: "base64data",
    previous: ["Old Look"],
  };

  it("builds correct structure", () => {
    const body = styleRequest(ask);
    expect(body.systemInstruction.parts[0].text).toContain("Instagram Story");
    expect(body.contents[0].role).toBe("user");
    expect(body.generationConfig.responseMimeType).toBe("application/json");
  });

  it("includes words, place, and previous in user text", () => {
    const body = styleRequest(ask);
    const textPart = body.contents[0].parts[0].text;
    expect(textPart).toContain('"Test"');
    expect(textPart).toContain("middle");
    expect(textPart).toContain("Old Look");
  });

  it("includes frame in inlineData", () => {
    const body = styleRequest(ask);
    const dataPart = body.contents[0].parts[1];
    expect(dataPart.inlineData.data).toBe("base64data");
    expect(dataPart.inlineData.mimeType).toBe("image/jpeg");
  });

  it("omits previous section if empty", () => {
    const body = styleRequest({ ...ask, previous: [] });
    const textPart = body.contents[0].parts[0].text;
    expect(textPart).not.toContain("Looks already tried");
  });
});

describe("contrast", () => {
  it("calculates contrast for black and white", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("calculates contrast for same color", () => {
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 1);
  });
});

describe("styleFromReply", () => {
  const makeReply = (text: string) => ({
    candidates: [{ content: { parts: [{ text }] } }],
  });

  it("parses valid JSON", () => {
    const json = JSON.stringify({
      name: "Test",
      why: "Reason",
      font: "inter",
      color: "#FFFFFF",
      background: "#000000",
      size: 0.05,
      bold: true,
      italic: false,
    });
    const res = styleFromReply(makeReply(json));
    expect(res).toEqual({
      name: "Test",
      why: "Reason",
      font: "inter",
      color: "#ffffff",
      background: "#000000",
      size: 0.05,
      bold: true,
      italic: false,
    });
  });

  it("parses fenced JSON", () => {
    const json = '```json\n{"font":"inter","color":"#ffffff"}\n```';
    const res = styleFromReply(makeReply(json));
    expect(res?.font).toBe("inter");
  });

  it("returns null for unknown font", () => {
    const json = JSON.stringify({ font: "unknown", color: "#ffffff" });
    expect(styleFromReply(makeReply(json))).toBeNull();
  });

  it("returns null for bad color", () => {
    const json = JSON.stringify({ font: "inter", color: "red" });
    expect(styleFromReply(makeReply(json))).toBeNull();
  });

  it("returns null for junk text", () => {
    expect(styleFromReply(makeReply("not json"))).toBeNull();
  });

  it("clamps size", () => {
    const jsonBig = JSON.stringify({ font: "inter", color: "#ffffff", size: 1.0 });
    expect(styleFromReply(makeReply(jsonBig))?.size).toBe(0.09);

    const jsonSmall = JSON.stringify({ font: "inter", color: "#ffffff", size: 0.01 });
    expect(styleFromReply(makeReply(jsonSmall))?.size).toBe(0.035);

    const jsonMissing = JSON.stringify({ font: "inter", color: "#ffffff" });
    expect(styleFromReply(makeReply(jsonMissing))?.size).toBe(0.055);
  });

  it("handles low contrast with dark background", () => {
    // Dark bg, dark text -> should switch to white
    const json = JSON.stringify({
      font: "inter",
      color: "#111111",
      background: "#222222",
    });
    const res = styleFromReply(makeReply(json));
    expect(res?.color).toBe("#ffffff");
  });

  it("handles low contrast with light background", () => {
    // Light bg, light text -> should switch to black
    const json = JSON.stringify({
      font: "inter",
      color: "#eeeeee",
      background: "#dddddd",
    });
    const res = styleFromReply(makeReply(json));
    expect(res?.color).toBe("#000000");
  });

  it("sets background to null if invalid", () => {
    const json = JSON.stringify({
      font: "inter",
      color: "#ffffff",
      background: "invalid",
    });
    const res = styleFromReply(makeReply(json));
    expect(res?.background).toBeNull();
  });

  it("defaults name and why", () => {
    const json = JSON.stringify({ font: "inter", color: "#ffffff" });
    const res = styleFromReply(makeReply(json));
    expect(res?.name).toBe("New look");
    expect(res?.why).toBe("");
  });
});
