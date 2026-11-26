/**
 * A Highlight's new cover (desktop app): grab a few moments of the video, let Gemini pick the one
 * that reads best in a small circle, cut a square from it and put it on the Highlight.
 */
import { brightness, candidates, sampleTimes, squareCrop } from "./coverFrames";

/** One grabbed moment: small, for Gemini to look at. */
export interface CoverFrame {
  time: number;
  brightness: number;
  /** Base64 JPEG, without the "data:" prefix. */
  jpeg: string;
}

export interface CoverSource {
  frames(): Promise<CoverFrame[]>;
  /** The square cover picture from one moment, as JPEG bytes. */
  square(time: number, center: number): Promise<Uint8Array>;
  close(): void;
}

/** Longest side of the pictures Gemini sees. */
const LOOK_SIDE = 512;
const COVER_SIDE = 1080;
const SEEK_MS = 10_000;

/** Reads moments out of a video with the browser's own player. */
export async function openVideo(blob: Blob): Promise<CoverSource> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  const once = (event: string, start: () => void) =>
    new Promise<void>((resolve, reject) => {
      const done = (fail?: Error) => {
        clearTimeout(timer);
        video.removeEventListener(event, ok);
        video.removeEventListener("error", bad);
        if (fail) reject(fail);
        else resolve();
      };
      const ok = () => done();
      const bad = () => done(new Error("The video could not be read for a cover."));
      const timer = setTimeout(bad, SEEK_MS);
      video.addEventListener(event, ok);
      video.addEventListener("error", bad);
      start();
    });

  const close = () => {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    await once("loadeddata", () => {
      video.src = url;
    });
  } catch (e) {
    close();
    throw e;
  }

  const seek = (time: number) => once("seeked", () => void (video.currentTime = time));
  const canvas = (width: number, height: number) => {
    const el = document.createElement("canvas");
    el.width = width;
    el.height = height;
    const ctx = el.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("The cover picture could not be drawn.");
    return { el, ctx };
  };

  return {
    async frames() {
      const scale = Math.min(1, LOOK_SIDE / Math.max(video.videoWidth, video.videoHeight, 1));
      const { el, ctx } = canvas(Math.max(1, Math.round(video.videoWidth * scale)), Math.max(1, Math.round(video.videoHeight * scale)));
      const out: CoverFrame[] = [];
      for (const time of sampleTimes(video.duration)) {
        await seek(time);
        ctx.drawImage(video, 0, 0, el.width, el.height);
        out.push({ time, brightness: brightness(ctx.getImageData(0, 0, el.width, el.height).data), jpeg: el.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "" });
      }
      return out;
    },
    async square(time, center) {
      await seek(time);
      const crop = squareCrop(video.videoWidth, video.videoHeight, center);
      const { el, ctx } = canvas(COVER_SIDE, COVER_SIDE);
      ctx.drawImage(video, crop.x, crop.y, crop.size, crop.size, 0, 0, COVER_SIDE, COVER_SIDE);
      const jpeg = await new Promise<Blob | null>((resolve) => el.toBlob(resolve, "image/jpeg", 0.92));
      if (!jpeg) throw new Error("The cover picture could not be made.");
      return new Uint8Array(await jpeg.arrayBuffer());
    },
    close,
  };
}

const plain = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The cover could not be made.");

/**
 * Makes a cover from the video and puts it on the Highlight with this name. Never throws: the note
 * says what happened, because the Story is already posted by the time this runs.
 */
export async function giveHighlightCover({
  video,
  name,
  pick,
  setCover,
  onStep,
  stopped,
  open = openVideo,
}: {
  video: Blob;
  name: string;
  /** Gemini's choice among the pictures sent: which one, and where to cut the square. */
  pick: (frames: string[]) => Promise<{ frame: number; center: number; by?: string }>;
  setCover: (name: string, jpeg: Uint8Array) => Promise<{ set: boolean; note: string }>;
  onStep: (label: string) => void;
  stopped: () => boolean;
  open?: (video: Blob) => Promise<CoverSource>;
}): Promise<{ set: boolean; note: string }> {
  const halted = { set: false, note: "Stopped before the cover was changed." };
  let source: CoverSource | null = null;
  try {
    onStep("Picking frames for the cover");
    source = await open(video);
    const usable = candidates((await source.frames()).filter((f) => f.jpeg));
    if (!usable.length) return { set: false, note: "No picture could be taken from the video, so the cover was not changed." };
    if (stopped()) return halted;
    onStep("Picking the best frame");
    const choice = await pick(usable.map((f) => f.jpeg));
    const frame = usable[choice.frame];
    if (!frame) return { set: false, note: "Gemini did not pick a frame, so the cover was not changed." };
    const jpeg = await source.square(frame.time, choice.center);
    if (stopped()) return halted;
    const result = await setCover(name, jpeg);
    return choice.by === "DeepSeek" ? { ...result, note: `${result.note} Gemini was busy, so DeepSeek picked it.` } : result;
  } catch (e) {
    return { set: false, note: `${plain(e).replace(/\.?$/, ".")} The cover was not changed.` };
  } finally {
    source?.close();
  }
}
