/**
 * Splits the phone's raw H.264 stream ("Annex B": units separated by 00 00 01 start codes) into
 * frames a WebCodecs VideoDecoder can take.
 */

/** Cuts a byte stream into units at each start code. The last unit is held back until `flush`, since its end is not known yet. */
export class AnnexBSplitter {
  private pending = new Uint8Array(0);

  /** Adds bytes; returns the units that are now complete, each without its start code. */
  push(bytes: Uint8Array): Uint8Array[] {
    const data = new Uint8Array(this.pending.length + bytes.length);
    data.set(this.pending);
    data.set(bytes, this.pending.length);
    const starts = startCodes(data);
    if (!starts.length) {
      this.pending = data;
      return [];
    }
    const out: Uint8Array[] = [];
    for (let i = 0; i < starts.length - 1; i++) {
      const unit = trimZeros(data.subarray(starts[i].after, starts[i + 1].at));
      if (unit.length) out.push(unit);
    }
    this.pending = data.slice(starts[starts.length - 1].at);
    return out;
  }

  /** The unit held back, when the stream has gone quiet (a frame is complete once nothing more follows). */
  flush(): Uint8Array[] {
    const starts = startCodes(this.pending);
    const unit = starts.length ? trimZeros(this.pending.subarray(starts[0].after)) : new Uint8Array(0);
    this.pending = new Uint8Array(0);
    return unit.length ? [unit.slice()] : [];
  }

  reset() {
    this.pending = new Uint8Array(0);
  }
}

function startCodes(data: Uint8Array): { at: number; after: number }[] {
  const found: { at: number; after: number }[] = [];
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;
    if (data[i + 2] === 1) {
      found.push({ at: i, after: i + 3 });
      i += 2;
    } else if (data[i + 2] === 0 && i + 3 < data.length && data[i + 3] === 1) {
      found.push({ at: i, after: i + 4 });
      i += 3;
    }
  }
  return found;
}

/** A unit never ends in a zero byte; trailing zeros belong to the next start code. */
function trimZeros(unit: Uint8Array): Uint8Array {
  let end = unit.length;
  while (end > 0 && unit[end - 1] === 0) end--;
  return unit.subarray(0, end);
}

export interface H264Frame {
  /** The frame's units, each with a 4-byte start code, ready for EncodedVideoChunk. */
  data: Uint8Array;
  /** True for a frame the decoder can start from. */
  key: boolean;
  /** WebCodecs codec string from the stream's settings (e.g. "avc1.42c029"), on key frames that carry them. */
  codec?: string;
}

const START = [0, 0, 0, 1];

/** Groups units into frames: settings units (SPS, PPS, SEI) travel with the picture that follows them. */
export class FrameAssembler {
  private held: Uint8Array[] = [];
  private codec: string | undefined;

  add(unit: Uint8Array): H264Frame | null {
    const type = unit[0] & 0x1f;
    if (type === 7 && unit.length >= 4) this.codec = `avc1.${[unit[1], unit[2], unit[3]].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    if (type !== 1 && type !== 5) {
      // Not a picture: keep it for the next one. Anything other than settings is dropped.
      if (type === 7 || type === 8 || type === 6) this.held.push(unit);
      return null;
    }
    const units = [...this.held, unit];
    this.held = [];
    const data = new Uint8Array(units.reduce((n, u) => n + 4 + u.length, 0));
    let at = 0;
    for (const u of units) {
      data.set(START, at);
      data.set(u, at + 4);
      at += 4 + u.length;
    }
    return { data, key: type === 5, codec: type === 5 ? this.codec : undefined };
  }

  reset() {
    this.held = [];
    this.codec = undefined;
  }
}
