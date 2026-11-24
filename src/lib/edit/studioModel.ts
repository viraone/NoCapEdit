import type { AiSettings } from "@/lib/edit/aiHighlights";
import "@/lib/ffmpeg/nativeFfmpeg"; // for the window.nocapDesktop type only

/** The Mac Studio model, as the desktop shell reports it. */
export interface StudioModel { model: string; name: string }

/** The placeholder sent as the API key. The real key is added by the desktop shell and never reaches the page. */
export const STUDIO_KEY_PLACEHOLDER = "mac-studio";

/** Resolves to the Studio model when the page runs in the desktop app and the Studio is set up there; null otherwise (always null on the website). Never throws. */
export async function loadStudioModel(): Promise<StudioModel | null> {
  if (typeof window === "undefined" || !window.nocapDesktop?.studio) return null;
  try {
    const info = await window.nocapDesktop.studio.info();
    if (!info.available || !info.model) return null;
    return { model: info.model, name: info.name || "Mac Studio" };
  } catch {
    return null;
  }
}

/** The address the page calls; the shell forwards it to the Studio. */
export function studioApiBase(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/studio/v1`;
}

/** The settings change that points the OpenAI-compatible provider at the Studio. */
export function studioAiPatch(studio: StudioModel, origin: string): Partial<AiSettings> {
  return {
    provider: "openai",
    apiBase: studioApiBase(origin),
    apiKey: STUDIO_KEY_PLACEHOLDER,
    apiModel: studio.model,
  };
}

/** True when these settings point at the Studio through the shell. */
export function isStudioSettings(s: Pick<AiSettings, "provider" | "apiBase">, origin: string): boolean {
  return s.provider === "openai" && s.apiBase.replace(/\/+$/, "") === studioApiBase(origin);
}
