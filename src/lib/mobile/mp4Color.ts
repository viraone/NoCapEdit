/**
 * Colour tags of a finished MP4: the `colr` box of the video sample entry.
 *
 * WebKit's VideoEncoder reports every stream as sRGB full range whatever it
 * was given — video-range NV12, RGBA, a canvas — and the muxer writes that
 * into the file's `colr` box. The pixels VideoToolbox actually encodes are
 * BT.709 video range, so players that trust the box (QuickTime, Photos,
 * ffmpeg) show the export washed out. The exporter knows what it fed the
 * encoder, so it puts the truth back with `writeColorTags`.
 *
 * Only Blob slices are read: a few bytes per top-level box and the `moov`
 * itself (kilobytes), never the media data.
 */

/** ISO 23001-8 code points, as in the `nclx` colr box. */
export interface ColorTags {
  primaries: number;
  transfer: number;
  matrix: number;
  fullRange: boolean;
}

export const BT709_VIDEO_RANGE: ColorTags = { primaries: 1, transfer: 1, matrix: 1, fullRange: false };

/** What WebKit's encoder claims for everything: sRGB (transfer 13), full range. */
export function looksLikeWebKitDefault(tags: ColorTags): boolean {
  return tags.transfer === 13 && tags.fullRange;
}

export function sameTags(a: ColorTags, b: ColorTags): boolean {
  return a.primaries === b.primaries && a.transfer === b.transfer && a.matrix === b.matrix && a.fullRange === b.fullRange;
}

interface Box {
  type: string;
  /** Offset of the box header. */
  start: number;
  /** Offset of the first byte after the box. */
  end: number;
  /** Offset of the box's payload. */
  body: number;
}

const decoder = new TextDecoder("latin1");

function parseHeader(view: DataView, at: number, limit: number): Box | null {
  if (at + 8 > limit) return null;
  let size = view.getUint32(at);
  const type = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + at + 4, 4));
  let body = at + 8;
  if (size === 1) {
    if (at + 16 > limit) return null;
    // 64-bit size; the high word is zero for anything a browser can hold.
    size = view.getUint32(at + 8) * 2 ** 32 + view.getUint32(at + 12);
    body = at + 16;
  } else if (size === 0) {
    size = limit - at; // to the end of the file
  }
  if (size < body - at || at + size > limit) return null;
  return { type, start: at, end: at + size, body };
}

function* children(view: DataView, from: number, to: number): Generator<Box> {
  let at = from;
  while (at < to) {
    const box = parseHeader(view, at, to);
    if (!box) return;
    yield box;
    at = box.end;
  }
}

/** Visual sample entries: 78 bytes of fixed fields before the child boxes. */
const VISUAL_ENTRY_FIELDS = 78;
const VISUAL_ENTRIES = new Set(["avc1", "avc3", "hvc1", "hev1", "av01", "vp09", "vp08"]);

/** Offset of the `colr` payload (the 4-byte type, then the tags) inside the `moov` box, or -1. */
function findColr(moov: DataView): number {
  const top = parseHeader(moov, 0, moov.byteLength);
  if (!top || top.type !== "moov") return -1;
  const descend = (from: number, to: number, path: string[]): number => {
    for (const box of children(moov, from, to)) {
      if (box.type !== path[0]) continue;
      if (path.length === 1) {
        // stsd: version/flags + entry count, then the sample entries.
        for (const entry of children(moov, box.body + 8, box.end)) {
          if (!VISUAL_ENTRIES.has(entry.type)) continue;
          for (const child of children(moov, entry.body + VISUAL_ENTRY_FIELDS, entry.end)) {
            if (child.type === "colr" && child.end - child.body >= 11) return child.body;
          }
          return -1;
        }
        continue;
      }
      const found = descend(box.body, box.end, path.slice(1));
      if (found !== -1) return found;
    }
    return -1;
  };
  return descend(top.body, top.end, ["trak", "mdia", "minf", "stbl", "stsd"]);
}

async function locateMoov(file: Blob): Promise<{ start: number; end: number } | null> {
  let at = 0;
  while (at + 8 <= file.size) {
    const head = new DataView(await file.slice(at, Math.min(file.size, at + 16)).arrayBuffer());
    const box = parseHeader(head, 0, file.size - at);
    if (!box) return null;
    if (box.type === "moov") return { start: at, end: at + box.end };
    at += box.end;
  }
  return null;
}

/** The video track's tags, or null when the file has no `nclx` colr box. */
export async function readColorTags(file: Blob): Promise<ColorTags | null> {
  const moov = await locateMoov(file);
  if (!moov) return null;
  const view = new DataView(await file.slice(moov.start, moov.end).arrayBuffer());
  const at = findColr(view);
  if (at === -1 || decoder.decode(new Uint8Array(view.buffer, at, 4)) !== "nclx") return null;
  return { primaries: view.getUint16(at + 4), transfer: view.getUint16(at + 6), matrix: view.getUint16(at + 8), fullRange: (view.getUint8(at + 10) & 0x80) !== 0 };
}

/** The same file with the video track's tags replaced; `file` itself when there is nothing to change. */
export async function writeColorTags(file: Blob, tags: ColorTags): Promise<Blob> {
  const moov = await locateMoov(file);
  if (!moov) return file;
  const bytes = new Uint8Array(await file.slice(moov.start, moov.end).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const at = findColr(view);
  if (at === -1 || decoder.decode(bytes.subarray(at, at + 4)) !== "nclx") return file;
  view.setUint16(at + 4, tags.primaries);
  view.setUint16(at + 6, tags.transfer);
  view.setUint16(at + 8, tags.matrix);
  view.setUint8(at + 10, tags.fullRange ? 0x80 : 0);
  return new Blob([file.slice(0, moov.start), bytes, file.slice(moov.end)], { type: file.type });
}
