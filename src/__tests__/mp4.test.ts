import { describe, expect, it } from "vitest";
import { countFragments, iterateBoxes, parseTrackTiming, renumberFragments, shiftFragments, stripInitSegment, stripTrailingIndex } from "@/lib/ffmpeg/mp4";

function box(type: string, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const out = new Uint8Array(8 + payload.length);
  new DataView(out.buffer).setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);
  return out;
}
function mfhd(seq: number): Uint8Array {
  const payload = new Uint8Array(8);
  new DataView(payload.buffer).setUint32(4, seq);
  return box("mfhd", payload);
}
function moof(seq: number): Uint8Array {
  return box("moof", mfhd(seq));
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe("mp4 utilities", () => {
  const segment = concat(box("ftyp"), box("moov", new Uint8Array(4)), moof(1), box("mdat", new Uint8Array(3)), moof(2), box("mdat"), box("mfra"));

  it("iterates top-level boxes", () => {
    expect([...iterateBoxes(segment)].map((b) => b.type)).toEqual(["ftyp", "moov", "moof", "mdat", "moof", "mdat", "mfra"]);
  });

  it("strips init and index boxes, keeping fragments", () => {
    const media = stripInitSegment(segment);
    expect([...iterateBoxes(media)].map((b) => b.type)).toEqual(["moof", "mdat", "moof", "mdat"]);
    expect(countFragments(media)).toBe(2);
  });

  it("removes only the trailing index from a first segment", () => {
    const first = stripTrailingIndex(segment);
    expect([...iterateBoxes(first)].map((b) => b.type)).toEqual(["ftyp", "moov", "moof", "mdat", "moof", "mdat"]);
  });

  it("renumbers fragment sequence numbers", () => {
    const media = stripInitSegment(segment);
    const next = renumberFragments(media, 7);
    expect(next).toBe(9);
    const seqs: number[] = [];
    for (const b of iterateBoxes(media)) {
      if (b.type === "moof") seqs.push(new DataView(media.buffer, media.byteOffset).getUint32(b.start + 8 + 12));
    }
    expect(seqs).toEqual([7, 8]);
  });
});

function fullBox(type: string, version: number, payload: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + payload.length);
  body[0] = version;
  body.set(payload, 4);
  return box(type, body);
}
function u32(...values: number[]): Uint8Array {
  const out = new Uint8Array(values.length * 4);
  const v = new DataView(out.buffer);
  values.forEach((n, i) => v.setUint32(i * 4, n >>> 0));
  return out;
}
/** Minimal trak: tkhd (id), mdia (mdhd timescale + hdlr kind), optional edts/elst (v0, one entry). */
function trak(id: number, timescale: number, kind: string, mediaTime: number | null): Uint8Array {
  const tkhd = fullBox("tkhd", 0, concat(u32(0, 0), u32(id), u32(0)));
  const mdhd = fullBox("mdhd", 0, concat(u32(0, 0), u32(timescale), u32(0)));
  const hdlr = fullBox("hdlr", 0, concat(u32(0), new TextEncoder().encode(kind), u32(0, 0, 0)));
  const mdia = box("mdia", concat(mdhd, hdlr));
  const edts = mediaTime === null ? new Uint8Array(0) : box("edts", fullBox("elst", 0, concat(u32(1), u32(0), new Uint8Array(new Uint32Array([mediaTime]).buffer).reverse(), u32(0x00010000))));
  return box("trak", concat(tkhd, mdia, edts));
}
function tfdtFragment(trackId: number, baseTime: number): Uint8Array {
  const tfhd = fullBox("tfhd", 0, u32(trackId));
  const tfdt = fullBox("tfdt", 0, u32(baseTime));
  return box("moof", concat(mfhd(1), box("traf", concat(tfhd, tfdt))));
}

describe("fragment timing", () => {
  const init = concat(box("ftyp"), box("moov", concat(trak(1, 15360, "vide", 0), trak(2, 48000, "soun", 1024))));

  it("reads timescale, handler and edit-list offset per track", () => {
    const tracks = parseTrackTiming(init);
    expect(tracks.get(1)).toEqual({ timescale: 15360, editOffset: 0, kind: "vide" });
    expect(tracks.get(2)).toEqual({ timescale: 48000, editOffset: 1024, kind: "soun" });
  });

  it("shifts fragment decode times by the segment start on both tracks", () => {
    const tracks = parseTrackTiming(init);
    const data = concat(tfdtFragment(1, 0), tfdtFragment(2, 0), tfdtFragment(2, 4096));
    shiftFragments(data, 9.6, tracks);
    const times: number[] = [];
    for (const moof of iterateBoxes(data)) {
      const view = new DataView(data.buffer, data.byteOffset);
      // moof(8) mfhd(16) traf(8) tfhd(16) tfdt(8 + 4 version) -> base time
      times.push(view.getUint32(moof.start + 8 + 16 + 8 + 16 + 8 + 4));
    }
    // Video: 9.6 s * 15360; audio: 9.6 s * 48000 = 460800 = 450 AAC frames, priming untouched.
    expect(times).toEqual([Math.round(9.6 * 15360), 460800, 460800 + 4096]);
  });
});
