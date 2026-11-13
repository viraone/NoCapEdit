import { describe, expect, it } from "vitest";
import { decodeMatte, encodeMatte, matteByteLength, parseMatteHeader, type MatteHeader } from "@/lib/matte/matte";

/** Builds an encoded matte header followed by an arbitrary payload. */
function framed(header: unknown, payload: Uint8Array = new Uint8Array([1, 2, 3])): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const buf = new Uint8Array(4 + json.length + payload.length);
  new DataView(buf.buffer).setUint32(0, json.length);
  buf.set(json, 4);
  buf.set(payload, 4 + json.length);
  return buf;
}

describe("parseMatteHeader", () => {
  it("reads the four size fields and points at the payload", () => {
    const buf = framed({ width: 4, height: 3, fps: 8, count: 2 });
    const { header, offset } = parseMatteHeader(buf);
    expect(header).toEqual({ width: 4, height: 3, fps: 8, count: 2 });
    expect(offset).toBe(buf.length - 3);
  });

  it("rejects empty, cut-off, and unreadable headers", () => {
    expect(() => parseMatteHeader(new Uint8Array(0))).toThrow(/empty or damaged/);
    const cutOff = new Uint8Array(6);
    new DataView(cutOff.buffer).setUint32(0, 100);
    expect(() => parseMatteHeader(cutOff)).toThrow(/header is cut off/);
    expect(() => parseMatteHeader(new Uint8Array([0, 0, 0, 3, 0x7b, 0x7b, 0x7b]))).toThrow(/not readable/);
  });

  it("rejects headers with impossible dimensions", () => {
    expect(() => parseMatteHeader(framed({ width: 0, height: 2, fps: 8, count: 1 }))).toThrow(/invalid size/);
    expect(() => parseMatteHeader(framed({ width: 2, height: 2, fps: 0, count: 1 }))).toThrow(/invalid size/);
    expect(() => parseMatteHeader(framed({ width: 2, height: 2, fps: 8, count: 1.5 }))).toThrow(/invalid size/);
    expect(() => parseMatteHeader(framed({ fps: 8 }))).toThrow(/invalid size/);
  });
});

describe("matteByteLength", () => {
  it("multiplies frames by pixels", () => {
    const header: MatteHeader = { width: 4, height: 3, fps: 8, count: 2 };
    expect(matteByteLength(header)).toBe(24);
  });

  it("refuses a size that cannot be a safe array length", () => {
    expect(() => matteByteLength({ width: Number.MAX_SAFE_INTEGER, height: 3, fps: 8, count: 2 })).toThrow(/impossible size/);
  });
});

describe("decodeMatte", () => {
  it("round-trips the header and every mask byte", async () => {
    const width = 3;
    const height = 2;
    const count = 3;
    const masks = Uint8Array.from({ length: count * width * height }, (_, i) => (i * 7) & 255);
    const out = await decodeMatte(encodeMatte({ width, height, fps: 8, count, masks }));
    expect(out.width).toBe(width);
    expect(out.height).toBe(height);
    expect(out.fps).toBe(8);
    expect(out.count).toBe(count);
    expect(Array.from(out.masks)).toEqual(Array.from(masks));
  });
});
