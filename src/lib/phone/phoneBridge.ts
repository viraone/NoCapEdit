/**
 * The Android emulator, as the page sees it inside the desktop app (desktop/phoneHost.mjs).
 * On the website `window.nocapDesktop` does not exist and none of this is used.
 */

export interface PhoneInfo {
  available: boolean;
  /** Why not, in plain words, when `available` is false. */
  reason?: string;
  device?: string;
  width?: number;
  height?: number;
  instagram?: boolean;
}

export type PhoneInput =
  | { kind: "tap"; x: number; y: number }
  | { kind: "swipe"; x1: number; y1: number; x2: number; y2: number; ms: number }
  | { kind: "key"; code: number }
  | { kind: "text"; text: string };

/** What the Post / Reel window asks Instagram to do. Sharing is a separate call. */
export interface ReelOptions {
  /** Off: stop on Instagram's trim tools instead of going on. */
  keepFull: boolean;
  /** Off: stop on the Reel editor. */
  next: boolean;
  /** Text to put on the video, or "". */
  overlay: string;
  caption: string;
  location: string;
  /** Usernames to tag, without the @. */
  people: string[];
}

export interface ReelOutcome {
  /** True when Instagram is on the caption screen with everything filled in, ready for Share. */
  ready: boolean;
  stoppedAt?: "trim" | "editor" | "cancelled" | "failed";
  error?: string;
  /** Things the user should know: the place that was picked, characters left out, people not found. */
  notes: string[];
}

/** Where a sticker or a line of text goes on a Story. */
export type StorySlot = "top" | "middle" | "bottom";

/** What the Story window asks Instagram to do. Sharing is a separate call. */
export interface StoryOptions {
  /** Turn the video's own sound off. */
  mute: boolean;
  /** Text to put on the picture, or "". */
  overlay: string;
  overlayAt: StorySlot;
  /** Web address for a Link sticker, or "" for none. */
  linkUrl: string;
  /** The words on the Link sticker in place of the address, or "". */
  linkLabel: string;
  linkAt: StorySlot;
}

/** What desktop/preload.cjs exposes as `window.nocapDesktop.phone`. */
export interface DesktopPhoneBridge {
  info(): Promise<PhoneInfo>;
  begin(): Promise<string>;
  write(id: string, data: Uint8Array): Promise<void>;
  send(id: string, name: string): Promise<{ path: string; uri: string }>;
  screen(on: boolean): Promise<{ width: number; height: number } | null>;
  onVideo(fn: ((chunk: Uint8Array | null) => void) | null): void;
  input(action: PhoneInput): Promise<{ dropped?: string[] }>;
  open(mode: "reel" | "story", uri: string): Promise<void>;
  /** Opens Instagram's home feed. "busy": Instagram has an editor or a draft open, and nothing was pressed. */
  instagramHome(): Promise<{ state: "home" | "busy" }>;
  reel(uri: string, options: ReelOptions): Promise<ReelOutcome>;
  /** Fills in the Story screen. `ready` means everything asked for is on the Story and it is waiting to be shared. */
  story(uri: string, options: StoryOptions): Promise<ReelOutcome>;
  /** Shares the open Story to "Your story" or to Close Friends. */
  shareStory(audience: "story" | "close"): Promise<{ shared: boolean }>;
  onStep(fn: ((label: string) => void) | null): void;
  cancel(): Promise<void>;
  share(): Promise<{ shared: boolean }>;
}

/** The phone bridge, or null on the website. */
export function phoneBridge(): DesktopPhoneBridge | null {
  if (typeof window === "undefined") return null;
  return window.nocapDesktop?.phone ?? null;
}

/** Bytes sent to the shell per message when copying a video across. */
const CHUNK_BYTES = 8 * 1024 * 1024;

/**
 * Copies a finished video into the phone's gallery. Returns its gallery address, which the
 * Instagram calls take.
 */
export async function sendToPhone(api: DesktopPhoneBridge, video: Blob, name: string, onProgress?: (fraction: number) => void): Promise<{ path: string; uri: string }> {
  const id = await api.begin();
  for (let offset = 0; offset < video.size; offset += CHUNK_BYTES) {
    await api.write(id, new Uint8Array(await video.slice(offset, offset + CHUNK_BYTES).arrayBuffer()));
    onProgress?.(Math.min(1, (offset + CHUNK_BYTES) / video.size));
  }
  return api.send(id, name);
}

/** The usernames in a "tag people" box: split on spaces and commas, @ removed, bad ones dropped. */
export function parsePeople(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.split(/[\s,]+/)) {
    const name = raw.trim().replace(/^@/, "");
    if (/^[A-Za-z0-9._]{1,30}$/.test(name)) seen.add(name);
  }
  return [...seen].slice(0, 10);
}

/** The emulator's own screen size mapped from a point on the drawn picture. */
export function toPhonePoint(px: number, py: number, drawn: { width: number; height: number }, phone: { width: number; height: number }): { x: number; y: number } {
  const x = Math.round((px / Math.max(1, drawn.width)) * phone.width);
  const y = Math.round((py / Math.max(1, drawn.height)) * phone.height);
  return { x: Math.min(phone.width - 1, Math.max(0, x)), y: Math.min(phone.height - 1, Math.max(0, y)) };
}
