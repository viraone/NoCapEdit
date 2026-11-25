import { describe, expect, it } from "vitest";
import { AnnexBSplitter, FrameAssembler } from "@/lib/phone/h264";
import { clampPanelWidth, PANEL_MIN_WIDTH, panelHeightFor, panelWidthFor, pictureSize } from "@/lib/phone/panelSize";
import { parsePeople, toPhonePoint } from "@/lib/phone/phoneBridge";
import { parseReelChoices, typeableNote, untypeable } from "@/lib/phone/reelChoices";

const bytes = (...n: number[]) => new Uint8Array(n);
const lists = (units: Uint8Array[]) => units.map((u) => Array.from(u));

describe("splitting the phone's video stream", () => {
  it("cuts at start codes and holds the last unit until the stream goes quiet", () => {
    const s = new AnnexBSplitter();
    expect(lists(s.push(bytes(0, 0, 0, 1, 0x67, 1, 2, 3, 0, 0, 1, 0x68, 9, 0, 0, 0, 1, 0x65, 7, 7)))).toEqual([
      [0x67, 1, 2, 3],
      [0x68, 9],
    ]);
    expect(lists(s.flush())).toEqual([[0x65, 7, 7]]);
    expect(s.flush()).toEqual([]);
  });

  it("joins a unit that arrives in two pieces", () => {
    const s = new AnnexBSplitter();
    expect(s.push(bytes(0, 0, 0, 1, 0x41, 1, 2))).toEqual([]);
    expect(lists(s.push(bytes(3, 4, 0, 0, 0, 1, 0x41, 9)))).toEqual([[0x41, 1, 2, 3, 4]]);
    expect(lists(s.flush())).toEqual([[0x41, 9]]);
  });

  it("joins a start code that is itself split across two pieces", () => {
    const s = new AnnexBSplitter();
    expect(s.push(bytes(0, 0, 0, 1, 0x41, 5, 0, 0))).toEqual([]);
    expect(lists(s.push(bytes(0, 1, 0x41, 6)))).toEqual([[0x41, 5]]);
  });

  it("builds frames, settings travelling with the picture after them", () => {
    const f = new FrameAssembler();
    expect(f.add(bytes(0x67, 0x42, 0xc0, 0x29, 0x8d))).toBeNull();
    expect(f.add(bytes(0x68, 0xce))).toBeNull();
    const key = f.add(bytes(0x65, 1, 2));
    expect(key?.key).toBe(true);
    expect(key?.codec).toBe("avc1.42c029");
    expect(Array.from(key!.data.subarray(0, 5))).toEqual([0, 0, 0, 1, 0x67]);
    expect(key!.data.length).toBe(4 + 5 + 4 + 2 + 4 + 3);
    const next = f.add(bytes(0x41, 5));
    expect(next?.key).toBe(false);
    expect(next?.codec).toBeUndefined();
    expect(Array.from(next!.data)).toEqual([0, 0, 0, 1, 0x41, 5]);
  });
});

describe("the Post / Reel window's choices", () => {
  it("defaults to everything ticked", () => {
    expect(parseReelChoices(null)).toEqual({ keepFull: true, next: true, share: true, location: "" });
    expect(parseReelChoices("{bad")).toEqual({ keepFull: true, next: true, share: true, location: "" });
  });

  it("keeps what was saved", () => {
    expect(parseReelChoices('{"share":false,"location":"The Venue"}')).toEqual({ keepFull: true, next: true, share: false, location: "The Venue" });
  });

  it("says what the phone cannot type", () => {
    expect(untypeable("plain text\nok")).toEqual([]);
    expect(untypeable("it’s")).toEqual([]);
    expect(untypeable("hi \u{1F3A4} café")).toEqual(["\u{1F3A4}", "é"]);
    expect(typeableNote("plain")).toBeNull();
    expect(typeableNote("café")).toContain("é");
  });

  it("reads usernames to tag", () => {
    expect(parsePeople("@one, two  @one bad!name")).toEqual(["one", "two"]);
    expect(parsePeople("")).toEqual([]);
  });

  it("maps a click on the picture to the phone's own pixels", () => {
    expect(toPhonePoint(50, 100, { width: 100, height: 200 }, { width: 1080, height: 2424 })).toEqual({ x: 540, y: 1212 });
    expect(toPhonePoint(-5, 9999, { width: 100, height: 200 }, { width: 1080, height: 2424 })).toEqual({ x: 0, y: 2423 });
  });
});

describe("the phone panel's size", () => {
  const phone = { width: 1080, height: 2424 };

  it("grows taller as it is dragged wider", () => {
    expect(panelHeightFor(304, phone)).toBe(Math.round(114 + (286 * 2424) / 1080));
    expect(panelHeightFor(500, phone)).toBeGreaterThan(panelHeightFor(304, phone));
    expect(Math.abs(panelWidthFor(panelHeightFor(420, phone), phone) - 420)).toBeLessThanOrEqual(1);
  });

  it("holds a dragged width to what the window can show", () => {
    const room = { height: 900, windowWidth: 1600 };
    expect(clampPanelWidth(50, room, phone)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(304, room, phone)).toBe(304);
    const widest = clampPanelWidth(5000, room, phone);
    expect(panelHeightFor(widest, phone)).toBeLessThanOrEqual(room.height + 2);
    expect(panelHeightFor(widest + 10, phone)).toBeGreaterThan(room.height);
  });

  it("never takes more than 60% of a narrow window, nor less than the minimum", () => {
    expect(clampPanelWidth(5000, { height: 3000, windowWidth: 1000 }, phone)).toBe(600);
    expect(clampPanelWidth(5000, { height: 300, windowWidth: 1000 }, phone)).toBe(PANEL_MIN_WIDTH);
  });

  it("draws the picture in the phone's own shape, whichever side is the tight one", () => {
    const tall = pictureSize({ width: 240, height: 846 }, phone);
    expect(tall.width).toBe(222);
    expect(Math.abs(tall.height / tall.width - 2424 / 1080)).toBeLessThan(0.02);
    const wide = pictureSize({ width: 900, height: 846 }, phone);
    expect(wide.height).toBe(732);
    expect(Math.abs(wide.height / wide.width - 2424 / 1080)).toBeLessThan(0.02);
  });
});
