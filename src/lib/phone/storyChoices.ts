import type { StorySlot } from "@/lib/phone/phoneBridge";

export interface StoryChoices {
  mute: boolean;
  share: boolean;
  audience: "story" | "close";
  linkUrl: string;
  linkLabel: string;
  linkAt: StorySlot;
  overlayAt: StorySlot;
  /** The exact name of the Highlight to add the shared Story to, or "" for none. */
  highlight: string;
  /** Have Gemini pick a new cover for that Highlight after the Story is added. */
  cover: boolean;
  /** Add the posted Story to the Highlight named in `highlight`. */
  addToHighlight: boolean;
  /** The song to add with Instagram's own Music button, or "" for none. */
  musicTitle: string;
  /** That song's artist. */
  musicArtist: string;
}

export const STORY_DEFAULTS: StoryChoices = { mute: false, share: true, audience: "story", linkUrl: "", linkLabel: "", linkAt: "bottom", overlayAt: "top", highlight: "", cover: false, addToHighlight: false, musicTitle: "", musicArtist: "" };

const KEY = "reelflow.storyChoices";

/** Reads saved choices from their stored text; anything missing or wrong falls back to the default. */
export function parseStoryChoices(text: string | null): StoryChoices {
  if (!text) return { ...STORY_DEFAULTS };
  try {
    const raw = JSON.parse(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return { ...STORY_DEFAULTS };
    const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
    const slot = (v: unknown, d: StorySlot): StorySlot =>
      v === "top" || v === "middle" || v === "bottom" ? v : d;
    return {
      mute: flag(raw.mute, STORY_DEFAULTS.mute),
      share: flag(raw.share, STORY_DEFAULTS.share),
      audience: raw.audience === "close" ? "close" : "story",
      linkUrl: typeof raw.linkUrl === "string" ? raw.linkUrl.slice(0, 200) : "",
      linkLabel: typeof raw.linkLabel === "string" ? raw.linkLabel.slice(0, 60) : "",
      linkAt: slot(raw.linkAt, STORY_DEFAULTS.linkAt),
      overlayAt: slot(raw.overlayAt, STORY_DEFAULTS.overlayAt),
      highlight: typeof raw.highlight === "string" ? raw.highlight.slice(0, 60) : "",
      cover: flag(raw.cover, STORY_DEFAULTS.cover),
      addToHighlight: typeof raw.addToHighlight === "boolean"
        ? raw.addToHighlight
        : typeof raw.highlight === "string" && raw.highlight.trim() !== "",
      musicTitle: typeof raw.musicTitle === "string" ? raw.musicTitle.slice(0, 80) : "",
      musicArtist: typeof raw.musicArtist === "string" ? raw.musicArtist.slice(0, 80) : "",
    };
  } catch {
    return { ...STORY_DEFAULTS };
  }
}

export function loadStoryChoices(): StoryChoices {
  try {
    return parseStoryChoices(typeof localStorage === "undefined" ? null : localStorage.getItem(KEY));
  } catch {
    return { ...STORY_DEFAULTS };
  }
}

export function saveStoryChoices(choices: StoryChoices): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(choices));
  } catch {
    // private window or storage blocked: the choices just are not remembered
  }
}
