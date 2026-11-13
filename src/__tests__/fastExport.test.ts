import { describe, expect, it } from "vitest";
import { FastExportUnsupported, fastExportCaptionedVideo, type FastExportOptions } from "@/lib/mobile/fastExport";

function options(over: Partial<FastExportOptions> = {}): FastExportOptions {
  return {
    file: new Blob([new Uint8Array([0])], { type: "video/mp4" }),
    cues: [],
    style: {} as FastExportOptions["style"],
    canvas: {} as HTMLCanvasElement,
    ...over,
  };
}

describe("fast export", () => {
  it("refuses up front, before touching the file or canvas, when WebCodecs is missing", async () => {
    // Node has no VideoDecoder/VideoEncoder. The caller relies on this first
    // check rejecting, so it can fall back to the real-time exporter.
    const canvas = {
      getContext: () => {
        throw new Error("the canvas must not be touched before the WebCodecs check");
      },
    } as unknown as HTMLCanvasElement;

    const error = await fastExportCaptionedVideo(options({ canvas })).then(
      () => null,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(FastExportUnsupported);
    expect((error as Error).name).toBe("FastExportUnsupported");
    expect((error as Error).message).toBe("WebCodecs is not available in this browser");
  });
});
