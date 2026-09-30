/**
 * Receives a classic (non-fragmented) MP4 from a chunked stream target
 * without holding the file in the JS heap. Everything past the first
 * HEAD_BYTES goes straight into Blob storage as it arrives; the head stays
 * a mutable buffer because that is where the muxer seeks back at the end to
 * patch the mdat box size (the only non-sequential write an MP4 muxer
 * makes when the moov box goes last).
 *
 * A fragmented MP4 would also keep memory flat, but iOS Photos won't
 * import one, so the share sheet loses "Save Video".
 */
export class BlobFileSink {
  private static readonly HEAD_BYTES = 16 * 1024 * 1024;
  private head = new Uint8Array(BlobFileSink.HEAD_BYTES);
  private headLength = 0;
  private tail: Blob[] = [];
  private tailEnd = BlobFileSink.HEAD_BYTES;

  write(data: Uint8Array, position: number) {
    const end = position + data.byteLength;
    if (position < BlobFileSink.HEAD_BYTES) {
      const inHead = Math.min(data.byteLength, BlobFileSink.HEAD_BYTES - position);
      this.head.set(data.subarray(0, inHead), position);
      this.headLength = Math.max(this.headLength, position + inHead);
      if (inHead === data.byteLength) return;
      data = data.subarray(inHead);
      position += inHead;
    }
    if (position !== this.tailEnd) {
      throw new Error(`Unsupported out-of-order write at ${position} (file end ${this.tailEnd})`);
    }
    this.tail.push(new Blob([data as BlobPart]));
    this.tailEnd = end;
  }

  finalize(): Blob {
    const headLen = this.tail.length ? BlobFileSink.HEAD_BYTES : this.headLength;
    return new Blob([this.head.subarray(0, headLen) as BlobPart, ...this.tail], { type: "video/mp4" });
  }
}
