import { createTextOverlay, type Overlay, type TextOverlay } from "@/lib/models/project";
import type { StorySlot } from "./phoneBridge";

/** Where the words sit, as a fraction of the frame height: the same places the Story window's Top / Middle / Bottom use on Instagram. */
export const STORY_TITLE_Y: Record<StorySlot, number> = { top: 0.2, middle: 0.455, bottom: 0.68 };

/** The editor title made from the words typed in the Story window: on screen for the whole video. */
export function storyTitle(text: string, slot: StorySlot, duration: number): TextOverlay {
  const overlay = createTextOverlay("title", 0, duration > 0 ? duration : 3);
  return {
    ...overlay,
    text: text.trim(),
    y: STORY_TITLE_Y[slot],
  };
}

/** A title that already has these words (so pressing the button twice does not stack two), else null. */
export function findStoryTitle(overlays: Overlay[], text: string): TextOverlay | null {
  const target = text.trim();
  for (const overlay of overlays) {
    if (overlay.kind === "text" && overlay.variant === "title" && overlay.text.trim() === target) {
      return overlay;
    }
  }
  return null;
}
