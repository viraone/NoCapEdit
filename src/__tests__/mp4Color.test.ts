import { describe, expect, it } from "vitest";
import { BT709_VIDEO_RANGE, looksLikeWebKitDefault, readColorTags, writeColorTags } from "@/lib/mobile/mp4Color";

const enc = new TextEncoder();

function box(type: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const len = 8 + parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  out.set(enc.encode(type), 4);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
const u16 = (v: number) => new Uint8Array([v >> 8, v & 255]);
const zeros = (n: number) => new Uint8Array(n);
const nclx = (p: number, t: number, m: number, full: boolean) => box("colr", enc.encode("nclx"), u16(p), u16(t), u16(m), new Uint8Array([full ? 0x80 : 0]));
const stsd = (...entries: Uint8Array[]) => box("stsd", zeros(4), new Uint8Array([0, 0, 0, entries.length]), ...entries);
const visual = (type: string, ...kids: Uint8Array[]) => box(type, zeros(78), ...kids);
const track = (sampleTable: Uint8Array) => box("trak", box("tkhd", zeros(84)), box("mdia", box("mdhd", zeros(24)), box("minf", box("stbl", sampleTable, box("stsz", zeros(12))))));
const ftyp = box("ftyp", enc.encode("isom"), zeros(4), enc.encode("isomiso2avc1mp41"));
const mdat = box("mdat", new Uint8Array(500).fill(0xab));

const webkitVideo = track(stsd(visual("avc1", box("avcC", zeros(20)), nclx(1, 13, 1, true), box("pasp", zeros(8)))));
const audio = track(stsd(box("mp4a", zeros(28), box("esds", zeros(30)))));

async function bytes(b: Blob) {
  return new Uint8Array(await b.arrayBuffer());
}

describe("mp4 colour tags", () => {
  it("reads the video track's nclx tags", async () => {
    const file = new Blob([ftyp, box("moov", box("mvhd", zeros(100)), webkitVideo), mdat]);
    expect(await readColorTags(file)).toEqual({ primaries: 1, transfer: 13, matrix: 1, fullRange: true });
  });

  it("recognises WebKit's sRGB-full-range claim", () => {
    expect(looksLikeWebKitDefault({ primaries: 1, transfer: 13, matrix: 1, fullRange: true })).toBe(true);
    expect(looksLikeWebKitDefault(BT709_VIDEO_RANGE)).toBe(false);
    expect(looksLikeWebKitDefault({ primaries: 9, transfer: 18, matrix: 9, fullRange: false })).toBe(false);
  });

  it("rewrites only the tags, leaving the rest of the file byte for byte", async () => {
    const moov = box("moov", box("mvhd", zeros(100)), audio, webkitVideo);
    const file = new Blob([ftyp, moov, mdat]);
    const fixed = await writeColorTags(file, BT709_VIDEO_RANGE);
    expect(fixed).not.toBe(file);
    expect(fixed.size).toBe(file.size);
    expect(await readColorTags(fixed)).toEqual(BT709_VIDEO_RANGE);
    const before = await bytes(file);
    const after = await bytes(fixed);
    const diffs: number[] = [];
    before.forEach((v, i) => {
      if (v !== after[i]) diffs.push(i);
    });
    // The transfer code (13 → 1, low byte) and the range flag: two bytes change.
    expect(diffs).toHaveLength(2);
    expect(diffs[1] - diffs[0]).toBe(3);
  });

  it("finds a moov that comes after the media data (streamed export)", async () => {
    const file = new Blob([ftyp, mdat, box("moov", box("mvhd", zeros(100)), webkitVideo, audio)]);
    const fixed = await writeColorTags(file, { primaries: 1, transfer: 1, matrix: 1, fullRange: true });
    expect(await readColorTags(fixed)).toEqual({ primaries: 1, transfer: 1, matrix: 1, fullRange: true });
    // The media data is untouched.
    expect((await bytes(fixed)).subarray(ftyp.length, ftyp.length + mdat.length)).toEqual(mdat);
  });

  it("leaves a file without colr alone", async () => {
    const file = new Blob([ftyp, box("moov", track(stsd(visual("avc1", box("avcC", zeros(20)))))), mdat]);
    expect(await readColorTags(file)).toBeNull();
    expect(await writeColorTags(file, BT709_VIDEO_RANGE)).toBe(file);
  });

  it("copes with junk", async () => {
    expect(await readColorTags(new Blob([new Uint8Array([1, 2, 3])]))).toBeNull();
    expect(await readColorTags(new Blob([box("free", zeros(3)), new Uint8Array([0, 0, 0, 99, 0x6d, 0x6f, 0x6f, 0x76])]))).toBeNull();
  });
});
