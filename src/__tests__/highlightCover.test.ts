import { describe, expect, it } from "vitest";
import { giveHighlightCover, type CoverSource } from "@/lib/phone/highlightCover";

/** A stand-in video: three moments, the first of them black. */
function fakeSource() {
  const log: string[] = [];
  const source: CoverSource = {
    frames: async () => [
      { time: 1, brightness: 2, jpeg: "black" },
      { time: 3, brightness: 90, jpeg: "faces" },
      { time: 5, brightness: 70, jpeg: "title" },
    ],
    square: async (time, center) => {
      log.push(`square ${time} ${center}`);
      return new Uint8Array([0xff, 0xd8, 0xff]);
    },
    close: () => void log.push("close"),
  };
  return { source, log };
}

const base = { video: new Blob(), name: "Thanksgiving", onStep: () => undefined, stopped: () => false };

describe("giving a Highlight a new cover", () => {
  it("sends only the usable frames and cuts the one Gemini picked", async () => {
    const { source, log } = fakeSource();
    const sent: string[][] = [];
    const set: string[] = [];
    const result = await giveHighlightCover({
      ...base,
      open: async () => source,
      pick: async (frames) => {
        sent.push(frames);
        return { frame: 1, center: 0.25 };
      },
      setCover: async (name) => {
        set.push(name);
        return { set: true, note: "done" };
      },
    });
    expect(result).toEqual({ set: true, note: "done" });
    expect(sent).toEqual([["faces", "title"]]);
    expect(log).toEqual(["square 5 0.25", "close"]);
    expect(set).toEqual(["Thanksgiving"]);
  });

  it("says when DeepSeek did the picking", async () => {
    const { source } = fakeSource();
    const result = await giveHighlightCover({ ...base, open: async () => source, pick: async () => ({ frame: 0, center: 0.5, by: "DeepSeek" }), setCover: async () => ({ set: true, note: "Gave it a new cover." }) });
    expect(result).toEqual({ set: true, note: "Gave it a new cover. Gemini was busy, so DeepSeek picked it." });
  });

  it("says why and changes nothing when Gemini fails", async () => {
    const { source, log } = fakeSource();
    let touched = false;
    const result = await giveHighlightCover({
      ...base,
      open: async () => source,
      pick: async () => {
        throw new Error("Error invoking remote method 'caption:cover': Error: Gemini did not answer.");
      },
      setCover: async () => {
        touched = true;
        return { set: true, note: "" };
      },
    });
    expect(result).toEqual({ set: false, note: "Gemini did not answer. The cover was not changed." });
    expect(touched).toBe(false);
    expect(log).toEqual(["close"]);
  });

  it("stops before the phone is touched", async () => {
    const { source } = fakeSource();
    let touched = false;
    let asked = false;
    const result = await giveHighlightCover({
      ...base,
      open: async () => source,
      stopped: () => asked,
      pick: async () => {
        asked = true;
        return { frame: 0, center: 0.5 };
      },
      setCover: async () => {
        touched = true;
        return { set: true, note: "" };
      },
    });
    expect(result.set).toBe(false);
    expect(touched).toBe(false);
  });

  it("does not cut a picture for a frame that was not sent", async () => {
    const { source, log } = fakeSource();
    const result = await giveHighlightCover({ ...base, open: async () => source, pick: async () => ({ frame: 7, center: 0.5 }), setCover: async () => ({ set: true, note: "" }) });
    expect(result.set).toBe(false);
    expect(log).toEqual(["close"]);
  });
});
