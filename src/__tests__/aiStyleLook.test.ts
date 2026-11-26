import { describe, expect, it } from "vitest";
import { lookFrom, lookOf, triedList } from "@/lib/phone/aiStyleLook";
import type { AiStyleReply, Look } from "@/lib/phone/aiStyleLook";

const base: Look = {
  fontFamily: "inter",
  color: "#ffffff",
  background: "#1d1d1f",
  fontSize: 0.06,
  bold: false,
  italic: true,
};

const reply: AiStyleReply = {
  name: "Night neon",
  why: "Bright letters on dark footage.",
  font: "bangers",
  color: "#ff3b30",
  background: null,
  size: 0.075,
  bold: true,
  italic: false,
};

describe("lookOf", () => {
  it("returns exactly the six style fields", () => {
    const out = lookOf(base);
    expect(out).toEqual(base);
    expect(Object.keys(out).sort()).toEqual(["background", "bold", "color", "fontFamily", "fontSize", "italic"]);
  });

  it("returns a new object, not the overlay itself", () => {
    const out = lookOf(base);
    expect(out).not.toBe(base);
  });

  it("does not copy other overlay fields", () => {
    const withExtras = { ...base, id: "text-1", kind: "text", text: "Hello", start: 0, end: 3 };
    const out = lookOf(withExtras);
    expect(Object.keys(out)).toHaveLength(6);
    expect(Object.prototype.hasOwnProperty.call(out, "id")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "kind")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "text")).toBe(false);
    expect(out.fontFamily).toBe("inter");
  });

  it("does not change the overlay it is given", () => {
    const overlay: Look = { ...base };
    lookOf(overlay);
    expect(overlay).toEqual(base);
  });
});

describe("lookFrom", () => {
  it("turns a reply into overlay style fields", () => {
    expect(lookFrom(reply)).toEqual({
      fontFamily: "bangers",
      color: "#ff3b30",
      background: null,
      fontSize: 0.075,
      bold: true,
      italic: false,
    });
  });

  it("keeps the reply's colour, background, size and weight", () => {
    const out = lookFrom({ ...reply, color: "#00ff88", background: "#000000", size: 0.04, bold: false, italic: true });
    expect(out.fontFamily).toBe("bangers");
    expect(out.color).toBe("#00ff88");
    expect(out.background).toBe("#000000");
    expect(out.fontSize).toBe(0.04);
    expect(out.bold).toBe(false);
    expect(out.italic).toBe(true);
  });

  it("does not change the reply it is given", () => {
    const input = { ...reply };
    lookFrom(input);
    expect(input).toEqual(reply);
  });
});

describe("triedList", () => {
  it("adds one line with the name, font, colour and background", () => {
    expect(triedList([], reply)).toEqual(["Night neon: bangers #ff3b30 on nothing"]);
  });

  it("names the background colour when there is one", () => {
    expect(triedList([], { ...reply, name: "Card", background: "#111111" })).toEqual(["Card: bangers #ff3b30 on #111111"]);
  });

  it("keeps the list it is given and returns a new one", () => {
    const tried = ["one", "two"];
    const out = triedList(tried, reply);
    expect(out).not.toBe(tried);
    expect(tried).toEqual(["one", "two"]);
    expect(out).toEqual(["one", "two", "Night neon: bangers #ff3b30 on nothing"]);
  });

  it("cuts a long line at 80 characters", () => {
    const long = { ...reply, name: "N".repeat(100) };
    const full = `${long.name}: ${long.font} ${long.color} on nothing`;
    expect(full.length).toBeGreaterThan(80);
    const out = triedList([], long);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(full.slice(0, 80));
    expect(out[0]).toHaveLength(80);
  });

  it("keeps only the last 12 looks", () => {
    const tried = Array.from({ length: 12 }, (_, i) => `old ${i}`);
    const out = triedList(tried, reply);
    expect(out).toHaveLength(12);
    expect(out[0]).toBe("old 1");
    expect(out[11]).toBe("Night neon: bangers #ff3b30 on nothing");
  });
});
