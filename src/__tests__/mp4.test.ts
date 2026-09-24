import { describe, expect, it } from "vitest";
import { countFragments, iterateBoxes, renumberFragments, stripInitSegment, stripTrailingIndex } from "@/lib/ffmpeg/mp4";

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
