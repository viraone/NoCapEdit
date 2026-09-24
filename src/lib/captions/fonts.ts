import type { FontKey } from "@/lib/models/project";

/** Fallback stacks used until the real web fonts are registered by the app. */
const FALLBACKS: Record<FontKey, string> = {
  inter: "Inter, system-ui, sans-serif",
  montserrat: "Montserrat, system-ui, sans-serif",
  bangers: "Bangers, Impact, sans-serif",
  playfair: "'Playfair Display', Georgia, serif",
  bebas: "'Bebas Neue', Impact, sans-serif",
  courier: "'Courier Prime', 'Courier New', monospace",
  marker: "'Permanent Marker', cursive",
  grotesk: "'Space Grotesk', system-ui, sans-serif",
};

export const FONT_LABELS: Record<FontKey, string> = {
  inter: "Inter",
  montserrat: "Montserrat",
  bangers: "Bangers",
  playfair: "Playfair Display",
  bebas: "Bebas Neue",
  courier: "Courier Prime",
  marker: "Permanent Marker",
  grotesk: "Space Grotesk",
};

export const FONT_KEYS = Object.keys(FALLBACKS) as FontKey[];

let families: Record<FontKey, string> = { ...FALLBACKS };

/** Called once by the app with the font-family strings produced by next/font. */
export function registerFontFamilies(map: Partial<Record<FontKey, string>>) {
  families = { ...families, ...map };
}

export function fontFamily(key: FontKey): string {
  return families[key] ?? FALLBACKS[key];
}

/** Ensures the fonts are loaded so canvas text uses the real typeface. */
export async function ensureFontsLoaded(): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return;
  const weights = [400, 700, 800, 900];
  const loads: Promise<unknown>[] = [];
  for (const key of FONT_KEYS) {
    for (const w of weights) {
      loads.push(document.fonts.load(`${w} 24px ${fontFamily(key)}`).catch(() => undefined));
      loads.push(document.fonts.load(`italic ${w} 24px ${fontFamily(key)}`).catch(() => undefined));
    }
  }
  await Promise.all(loads);
}
