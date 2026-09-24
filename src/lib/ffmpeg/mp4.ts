/**
 * Minimal ISO-BMFF (MP4) box utilities used to stream a long render to disk.
 * ffmpeg writes every segment as a fragmented MP4 (ftyp + moov + moof/mdat…).
 * Only the first segment keeps its init part; later segments contribute their
 * fragments, whose sequence numbers are renumbered so the result is one valid
 * fragmented MP4 that plays in browsers, VLC, QuickTime and uploads fine.
 */

export interface Mp4Box {
  type: string;
  start: number;
  size: number;
  headerSize: number;
}

const decoder = new TextDecoder("ascii");

export function* iterateBoxes(data: Uint8Array): Generator<Mp4Box> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  while (offset + 8 <= data.length) {
    let size = view.getUint32(offset);
    const type = decoder.decode(data.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > data.length) break;
      size = Number(view.getBigUint64(offset + 8));
      headerSize = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size < headerSize) break;
    yield { type, start: offset, size, headerSize };
    offset += size;
  }
}

const INIT_BOXES = new Set(["ftyp", "moov", "sidx", "mfra", "free", "skip"]);

/** Drops init/index boxes so only media fragments (moof + mdat) remain. */
export function stripInitSegment(data: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const box of iterateBoxes(data)) {
    if (INIT_BOXES.has(box.type)) continue;
    const slice = data.subarray(box.start, box.start + box.size);
    parts.push(slice);
    total += slice.length;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Removes trailing index boxes (mfra) that only make sense at the end of a file. */
export function stripTrailingIndex(data: Uint8Array): Uint8Array {
  const boxes = [...iterateBoxes(data)];
  let end = data.length;
  for (let i = boxes.length - 1; i >= 0; i--) {
    if (boxes[i].type === "mfra" || boxes[i].type === "free" || boxes[i].type === "skip") end = boxes[i].start;
    else break;
  }
  return data.subarray(0, end);
}

/**
 * Rewrites every moof/mfhd sequence number in place, starting at `startSeq`.
 * Returns the next sequence number to use.
 */
export function renumberFragments(data: Uint8Array, startSeq: number): number {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let seq = startSeq;
  for (const box of iterateBoxes(data)) {
    if (box.type !== "moof") continue;
    const inner = box.start + box.headerSize;
    if (inner + 16 > data.length) continue;
    const childType = decoder.decode(data.subarray(inner + 4, inner + 8));
    if (childType !== "mfhd") continue;
    view.setUint32(inner + 12, seq++);
  }
  return seq;
}

export function countFragments(data: Uint8Array): number {
  let n = 0;
  for (const box of iterateBoxes(data)) if (box.type === "moof") n++;
  return n;
}

// ---------------------------------------------------------------------------
// Timestamp shifting for spliced segments. The mov muxer starts every segment
// at decode time 0; the retained moov of the first segment carries the edit
// list (AAC priming of 1024 samples, written thanks to delay_moov), and that
// edit list applies to the whole spliced track. Every segment's own priming
// frame sits at the head of its media timeline exactly like the first one, so
// a fragment only needs new = old + start * timescale to line up: the edit
// list then places its content at `start` on the presentation timeline.
// ---------------------------------------------------------------------------

export interface TrackTiming {
  timescale: number;
  /** Media time skipped by the first edit-list entry (priming / delay), in track units. */
  editOffset: number;
  /** Handler type: "vide", "soun", … */
  kind: string;
}

function children(data: Uint8Array, box: Mp4Box): Mp4Box[] {
  return [...iterateBoxes(data.subarray(box.start + box.headerSize, box.start + box.size))].map((b) => ({ ...b, start: b.start + box.start + box.headerSize }));
}

/** Reads track id, timescale and edit-list offset for each track in an init segment. */
export function parseTrackTiming(init: Uint8Array): Map<number, TrackTiming> {
  const view = new DataView(init.buffer, init.byteOffset, init.byteLength);
  const out = new Map<number, TrackTiming>();
  const moov = [...iterateBoxes(init)].find((b) => b.type === "moov");
  if (!moov) return out;
  for (const trak of children(init, moov)) {
    if (trak.type !== "trak") continue;
    let trackId = -1;
    let timescale = 0;
    let editOffset = 0;
    let kind = "";
    for (const child of children(init, trak)) {
      if (child.type === "tkhd") {
        const version = init[child.start + child.headerSize];
        trackId = view.getUint32(child.start + child.headerSize + (version === 1 ? 20 : 12));
      } else if (child.type === "mdia") {
        const mdhd = children(init, child).find((b) => b.type === "mdhd");
        if (mdhd) {
          const version = init[mdhd.start + mdhd.headerSize];
          timescale = view.getUint32(mdhd.start + mdhd.headerSize + (version === 1 ? 20 : 12));
        }
        const hdlr = children(init, child).find((b) => b.type === "hdlr");
        if (hdlr) kind = decoder.decode(init.subarray(hdlr.start + hdlr.headerSize + 8, hdlr.start + hdlr.headerSize + 12));
      } else if (child.type === "edts") {
        const elst = children(init, child).find((b) => b.type === "elst");
        if (elst) {
          const base = elst.start + elst.headerSize;
          const version = init[base];
          const count = view.getUint32(base + 4);
          let p = base + 8;
          for (let i = 0; i < count; i++) {
            const mediaTime = version === 1 ? Number(view.getBigInt64(p + 8)) : view.getInt32(p + 4);
            p += version === 1 ? 20 : 12;
            if (mediaTime >= 0) {
              editOffset = mediaTime;
              break;
            }
          }
        }
      }
    }
    if (trackId >= 0 && timescale > 0) out.set(trackId, { timescale, editOffset, kind });
  }
  return out;
}

/**
 * Shifts every fragment's baseMediaDecodeTime in place by `seconds` (rounded
 * to whole track units). Audio keeps its priming frame: the exporter shortens
 * the previous segment's audio by one AAC frame so it slots in without
 * overlap, and the first segment's edit list hides it on playback. Segment
 * starts snap to whole AAC and video frames (see segments.ts) so the rounding
 * here is exact and the decode timeline stays contiguous.
 */
export function shiftFragments(data: Uint8Array, seconds: number, tracks: Map<number, TrackTiming>): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (const moof of iterateBoxes(data)) {
    if (moof.type !== "moof") continue;
    for (const traf of children(data, moof)) {
      if (traf.type !== "traf") continue;
      let trackId = -1;
      for (const child of children(data, traf)) {
        if (child.type === "tfhd") trackId = view.getUint32(child.start + child.headerSize + 4);
        if (child.type === "tfdt") {
          const timing = tracks.get(trackId);
          if (!timing) continue;
          const delta = Math.round(seconds * timing.timescale);
          const p = child.start + child.headerSize;
          const version = data[p];
          if (version === 1) {
            view.setBigUint64(p + 4, BigInt(Math.max(0, Number(view.getBigUint64(p + 4)) + delta)));
          } else {
            const next = view.getUint32(p + 4) + delta;
            if (next > 0xffffffff) throw new Error("Fragment decode time overflows 32 bits; re-export with shorter segments.");
            view.setUint32(p + 4, Math.max(0, next));
          }
        }
      }
    }
  }
}
