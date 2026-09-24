export type SafeZoneKind = "none" | "reels" | "tiktok" | "shorts";

export interface FrameFormat {
  id: string;
  name: string;
  platform: string;
  width: number;
  height: number;
  ratio: string;
  /** Default safe-zone mask suggested for this format. */
  safeZone: SafeZoneKind;
}

/** 20 platform presets. Dimensions are the export size in pixels. */
export const FRAME_FORMATS: FrameFormat[] = [
  { id: "ig-reels", name: "Instagram Reels", platform: "Instagram", width: 1080, height: 1920, ratio: "9:16", safeZone: "reels" },
  { id: "ig-story", name: "Instagram Story", platform: "Instagram", width: 1080, height: 1920, ratio: "9:16", safeZone: "reels" },
  { id: "ig-square", name: "Instagram Post (Square)", platform: "Instagram", width: 1080, height: 1080, ratio: "1:1", safeZone: "none" },
  { id: "ig-portrait", name: "Instagram Post (4:5)", platform: "Instagram", width: 1080, height: 1350, ratio: "4:5", safeZone: "none" },
  { id: "tiktok", name: "TikTok", platform: "TikTok", width: 1080, height: 1920, ratio: "9:16", safeZone: "tiktok" },
  { id: "yt-shorts", name: "YouTube Shorts", platform: "YouTube", width: 1080, height: 1920, ratio: "9:16", safeZone: "shorts" },
  { id: "yt-landscape", name: "YouTube 1080p", platform: "YouTube", width: 1920, height: 1080, ratio: "16:9", safeZone: "none" },
  { id: "fb-reels", name: "Facebook Reels", platform: "Facebook", width: 1080, height: 1920, ratio: "9:16", safeZone: "reels" },
  { id: "fb-feed", name: "Facebook Feed", platform: "Facebook", width: 1080, height: 1350, ratio: "4:5", safeZone: "none" },
  { id: "snap-spotlight", name: "Snapchat Spotlight", platform: "Snapchat", width: 1080, height: 1920, ratio: "9:16", safeZone: "tiktok" },
  { id: "pinterest-pin", name: "Pinterest Pin", platform: "Pinterest", width: 1000, height: 1500, ratio: "2:3", safeZone: "none" },
  { id: "linkedin-video", name: "LinkedIn Video", platform: "LinkedIn", width: 1920, height: 1080, ratio: "16:9", safeZone: "none" },
  { id: "linkedin-square", name: "LinkedIn Square", platform: "LinkedIn", width: 1080, height: 1080, ratio: "1:1", safeZone: "none" },
  { id: "x-landscape", name: "X / Twitter 720p", platform: "X", width: 1280, height: 720, ratio: "16:9", safeZone: "none" },
  { id: "x-square", name: "X / Twitter Square", platform: "X", width: 1080, height: 1080, ratio: "1:1", safeZone: "none" },
  { id: "threads", name: "Threads", platform: "Threads", width: 1080, height: 1350, ratio: "4:5", safeZone: "none" },
  { id: "vertical", name: "Vertical 9:16", platform: "Generic", width: 1080, height: 1920, ratio: "9:16", safeZone: "none" },
  { id: "square", name: "Square 1:1", platform: "Generic", width: 1080, height: 1080, ratio: "1:1", safeZone: "none" },
  { id: "widescreen", name: "Widescreen 16:9", platform: "Generic", width: 1920, height: 1080, ratio: "16:9", safeZone: "none" },
  { id: "classic", name: "Classic 4:3", platform: "Generic", width: 1440, height: 1080, ratio: "4:3", safeZone: "none" },
];

export const DEFAULT_FORMAT_ID = "ig-reels";

export function getFormat(id: string): FrameFormat {
  return FRAME_FORMATS.find((f) => f.id === id) ?? FRAME_FORMATS[0];
}

/**
 * Safe zone masks. Values are fractions of the frame that the platform UI
 * typically covers. Content inside the remaining area stays visible.
 */
export interface SafeZoneMask {
  top: number;
  bottom: number;
  left: number;
  right: number;
  label: string;
}

export const SAFE_ZONES: Record<Exclude<SafeZoneKind, "none">, SafeZoneMask> = {
  reels: { top: 0.14, bottom: 0.35, left: 0.0, right: 0.18, label: "Instagram Reels" },
  tiktok: { top: 0.07, bottom: 0.25, left: 0.05, right: 0.14, label: "TikTok" },
  shorts: { top: 0.06, bottom: 0.2, left: 0.0, right: 0.14, label: "YouTube Shorts" },
};
