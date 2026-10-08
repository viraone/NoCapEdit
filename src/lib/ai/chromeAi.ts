/**
 * Chrome's built-in AI (Gemini Nano), which runs on the user's own computer.
 *
 * Two ways in are used. The Prompt API (`LanguageModel`) can answer in JSON and read a picture;
 * the Writer API (`Writer`) only writes text, so it is the fallback. Both are still being rolled out,
 * so everything here asks first and reports why not.
 */
import type { PostDraft } from "@/lib/models/project";
import { POST_SCHEMA, SYSTEM_PROMPT, buildUserPrompt, fitSource, hashtagCount, hashtagsFromText, parsePostReply, type PostRequest } from "./postPrompt";

export type AiAvailability = "unavailable" | "downloadable" | "downloading" | "available";

interface Monitor {
  addEventListener(type: "downloadprogress", cb: (e: { loaded: number }) => void): void;
}
interface PromptSession {
  prompt(input: unknown, opts?: { signal?: AbortSignal; responseConstraint?: object }): Promise<string>;
  destroy(): void;
}
interface LanguageModelStatic {
  availability(opts?: unknown): Promise<AiAvailability>;
  create(opts?: unknown): Promise<PromptSession>;
}
interface WriterInstance {
  write(input: string, opts?: { context?: string; signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
interface WriterStatic {
  availability(opts?: unknown): Promise<AiAvailability>;
  create(opts?: unknown): Promise<WriterInstance>;
}

const scope = () => globalThis as unknown as { LanguageModel?: LanguageModelStatic; Writer?: WriterStatic };

const TEXT_IN = [{ type: "text", languages: ["en"] }];
const TEXT_OUT = [{ type: "text", languages: ["en"] }];

export interface AiStatus {
  /** Which API will do the writing; null when this browser has neither. */
  api: "prompt" | "writer" | null;
  availability: AiAvailability;
  /** Whether a picture can be handed to the model (Prompt API only). */
  image: boolean;
}

async function safely<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/** What this browser can do, without downloading anything. */
export async function checkChromeAi(): Promise<AiStatus> {
  const { LanguageModel, Writer } = scope();
  if (LanguageModel) {
    const text = await safely(() => LanguageModel.availability({ expectedInputs: TEXT_IN, expectedOutputs: TEXT_OUT }));
    if (text && text !== "unavailable") {
      const img = await safely(() => LanguageModel.availability({ expectedInputs: [...TEXT_IN, { type: "image" }], expectedOutputs: TEXT_OUT }));
      return { api: "prompt", availability: text, image: !!img && img !== "unavailable" };
    }
  }
  if (Writer) {
    const w = await safely(() => Writer.availability({ expectedInputLanguages: ["en"], outputLanguage: "en" }));
    if (w && w !== "unavailable") return { api: "writer", availability: w, image: false };
  }
  return { api: null, availability: "unavailable", image: false };
}

export interface GenerateOptions {
  /** A picture to read (a frame of the video). Only used when the Prompt API takes images. */
  image?: CanvasImageSource | null;
  signal?: AbortSignal;
  /** First-use model download, 0..1. */
  onDownload?: (fraction: number) => void;
}

const monitorFor = (onDownload?: (f: number) => void) => (m: Monitor) => m.addEventListener("downloadprogress", (e) => onDownload?.(e.loaded));

/** Writes a title, caption and hashtags for the video. Throws a readable Error when it cannot. */
export async function generatePost(req: PostRequest, status: AiStatus, opts: GenerateOptions = {}): Promise<PostDraft> {
  const { LanguageModel, Writer } = scope();
  const tags = hashtagCount(req.platform);
  if (status.api === "prompt" && LanguageModel) {
    const withImage = !!opts.image && status.image;
    const session = await LanguageModel.create({
      expectedInputs: withImage ? [...TEXT_IN, { type: "image" }] : TEXT_IN,
      expectedOutputs: TEXT_OUT,
      initialPrompts: [{ role: "system", content: SYSTEM_PROMPT }],
      monitor: monitorFor(opts.onDownload),
      signal: opts.signal,
    });
    try {
      const text = buildUserPrompt(req);
      const input = withImage ? [{ role: "user", content: [{ type: "text", value: `${text}\n\nThe picture is a frame of the video; read any text on it.` }, { type: "image", value: opts.image }] }] : text;
      const reply = await session.prompt(input, { signal: opts.signal, responseConstraint: POST_SCHEMA });
      return parsePostReply(reply, tags);
    } finally {
      session.destroy();
    }
  }
  if (status.api === "writer" && Writer) {
    const writer = await Writer.create({
      tone: req.tone === "professional" ? "formal" : req.tone === "friendly" || req.tone === "chill" ? "neutral" : "casual",
      format: "plain-text",
      length: req.length,
      sharedContext: `A social media post for ${req.platform} about a short video. Use only facts from the material.`,
      expectedInputLanguages: ["en"],
      outputLanguage: "en",
      monitor: monitorFor(opts.onDownload),
      signal: opts.signal,
    });
    try {
      const material = `${fitSource(req.source)}${req.notes.trim() ? `\nAlso mention: ${req.notes.trim()}` : ""}`;
      const caption = await writer.write(`Write the caption of a post about this video. Do not use hashtags.\n\n${material}`, { signal: opts.signal });
      const title = await writer.write(`Write a title of at most 8 words for a video about this. Reply with the title only.\n\n${material}`, { signal: opts.signal });
      const hashtags = await writer.write(`Write ${tags} hashtags for a post about this video. Reply with the hashtags only, separated by spaces.\n\n${material}`, { signal: opts.signal });
      return { title: title.trim().replace(/^["“]|["”]$/g, ""), caption: caption.trim(), hashtags: hashtagsFromText(hashtags).slice(0, tags) };
    } finally {
      writer.destroy();
    }
  }
  throw new Error("This browser has no built-in AI to write with.");
}

/** A frame of a video file as an image the model can read, scaled to at most `maxSide` px. */
export async function frameOf(blob: Blob, time = 0, maxSide = 1024): Promise<HTMLCanvasElement> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Could not open the picture to read it."));
    });
    if (time > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = Math.min(time, Math.max(0, (video.duration || time) - 0.05));
      });
    }
    const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
