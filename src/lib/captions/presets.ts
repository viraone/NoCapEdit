import type { FontKey } from "@/lib/models/project";

export type PresetCategory = "social" | "business" | "retro";
export type HighlightMode = "color" | "box" | "scale" | "underline";

export interface CaptionPreset {
  id: string;
  name: string;
  category: PresetCategory;
  font: FontKey;
  weight: number;
  italic?: boolean;
  /** Font size as a fraction of the frame height. */
  size: number;
  color: string;
  accent: string;
  highlight: HighlightMode;
  uppercase?: boolean;
  /** Letter spacing in em. */
  letterSpacing?: number;
  lineHeight: number;
  /** Stroke width as a fraction of the font size. */
  stroke?: { color: string; width: number };
  /** Shadow blur and offsets as fractions of the font size. */
  shadow?: { color: string; blur: number; x: number; y: number };
  /** Background box. Padding and radius as fractions of the font size. */
  box?: { color: string; padX: number; padY: number; radius: number; mode: "line" | "block" };
  /** Glow (blurred copy of the text drawn behind it). */
  glow?: { color: string; blur: number };
  /** Animated entrance of the active word. Exported through the compositor path. */
  animation?: "pop" | "bounce";
  /** Append keyword emoji by default. */
  emoji?: boolean;
  /** Suggested words per caption for this look. */
  wordsPerCue?: number;
}

export const CAPTION_PRESETS: CaptionPreset[] = [
  // Social
  { id: "clean", name: "Clean", category: "social", font: "inter", weight: 800, size: 0.042, color: "#ffffff", accent: "#facc15", highlight: "color", lineHeight: 1.25, shadow: { color: "rgba(0,0,0,0.6)", blur: 0.18, x: 0, y: 0.06 } },
  { id: "pop", name: "Pop", category: "social", font: "montserrat", weight: 900, size: 0.046, color: "#ffffff", accent: "#ff3b81", highlight: "scale", uppercase: true, lineHeight: 1.2, stroke: { color: "#000000", width: 0.16 }, shadow: { color: "rgba(0,0,0,0.5)", blur: 0.1, x: 0, y: 0.08 } },
  { id: "paper", name: "Paper", category: "social", font: "courier", weight: 700, size: 0.038, color: "#1a1a1a", accent: "#d9480f", highlight: "color", lineHeight: 1.3, box: { color: "#fffdf5", padX: 0.5, padY: 0.2, radius: 0.1, mode: "line" } },
  { id: "comic", name: "Comic", category: "social", font: "bangers", weight: 400, size: 0.056, color: "#ffe600", accent: "#ff3d00", highlight: "color", uppercase: true, letterSpacing: 0.04, lineHeight: 1.1, stroke: { color: "#000000", width: 0.14 }, shadow: { color: "rgba(0,0,0,0.9)", blur: 0, x: 0.06, y: 0.06 } },
  { id: "neon", name: "Neon", category: "social", font: "montserrat", weight: 700, size: 0.042, color: "#fbcfe8", accent: "#22d3ee", highlight: "color", lineHeight: 1.3, glow: { color: "#ec4899", blur: 0.5 }, shadow: { color: "rgba(236,72,153,0.9)", blur: 0.35, x: 0, y: 0 } },
  { id: "hormozi", name: "Hormozi", category: "social", font: "montserrat", weight: 900, size: 0.056, color: "#ffffff", accent: "#facc15", highlight: "color", uppercase: true, lineHeight: 1.12, stroke: { color: "#000000", width: 0.18 }, shadow: { color: "rgba(0,0,0,0.85)", blur: 0, x: 0.06, y: 0.07 }, animation: "pop", emoji: true, wordsPerCue: 2 },
  { id: "beast", name: "Beast", category: "social", font: "bangers", weight: 400, size: 0.064, color: "#ffde00", accent: "#22d3ee", highlight: "scale", uppercase: true, letterSpacing: 0.03, lineHeight: 1.1, stroke: { color: "#000000", width: 0.16 }, shadow: { color: "rgba(0,0,0,0.9)", blur: 0.05, x: 0.05, y: 0.08 }, animation: "bounce", emoji: true, wordsPerCue: 3 },
  { id: "mint", name: "Mint", category: "social", font: "inter", weight: 800, size: 0.04, color: "#ffffff", accent: "#fde68a", highlight: "color", lineHeight: 1.35, box: { color: "rgba(16,185,129,0.92)", padX: 0.55, padY: 0.25, radius: 0.5, mode: "line" } },
  // Business
  { id: "boxed", name: "Boxed", category: "business", font: "inter", weight: 700, size: 0.038, color: "#ffffff", accent: "#60a5fa", highlight: "color", lineHeight: 1.35, box: { color: "rgba(0,0,0,0.85)", padX: 0.45, padY: 0.22, radius: 0.08, mode: "line" } },
  { id: "soft", name: "Soft", category: "business", font: "inter", weight: 600, size: 0.038, color: "#ffffff", accent: "#fbbf24", highlight: "color", lineHeight: 1.35, box: { color: "rgba(0,0,0,0.38)", padX: 0.6, padY: 0.35, radius: 0.45, mode: "block" }, shadow: { color: "rgba(0,0,0,0.4)", blur: 0.2, x: 0, y: 0.04 } },
  { id: "outline", name: "Outline", category: "business", font: "montserrat", weight: 800, size: 0.042, color: "#ffffff", accent: "#38bdf8", highlight: "color", lineHeight: 1.25, stroke: { color: "#0f172a", width: 0.1 } },
  { id: "glow", name: "Glow", category: "business", font: "inter", weight: 800, size: 0.042, color: "#ffffff", accent: "#a78bfa", highlight: "color", lineHeight: 1.25, glow: { color: "rgba(255,255,255,0.85)", blur: 0.45 }, shadow: { color: "rgba(0,0,0,0.5)", blur: 0.2, x: 0, y: 0.05 } },
  { id: "slate", name: "Slate", category: "business", font: "grotesk", weight: 700, size: 0.038, color: "#e2e8f0", accent: "#34d399", highlight: "underline", lineHeight: 1.35, box: { color: "rgba(30,41,59,0.92)", padX: 0.5, padY: 0.25, radius: 0.2, mode: "line" } },
  { id: "caps", name: "Caps", category: "business", font: "bebas", weight: 400, size: 0.06, color: "#ffffff", accent: "#f97316", highlight: "underline", uppercase: true, letterSpacing: 0.06, lineHeight: 1.05, shadow: { color: "rgba(0,0,0,0.6)", blur: 0.15, x: 0, y: 0.05 } },
  // Retro
  { id: "sunset", name: "Sunset", category: "retro", font: "montserrat", weight: 900, size: 0.046, color: "#ffd166", accent: "#06d6a0", highlight: "color", uppercase: true, lineHeight: 1.2, stroke: { color: "#5a1d3a", width: 0.12 }, shadow: { color: "#ef476f", blur: 0, x: 0.08, y: 0.08 } },
  { id: "blackbox", name: "Black box", category: "retro", font: "inter", weight: 900, size: 0.042, color: "#ffffff", accent: "#fde047", highlight: "color", uppercase: true, letterSpacing: 0.02, lineHeight: 1.3, box: { color: "#000000", padX: 0.35, padY: 0.15, radius: 0, mode: "line" } },
  { id: "sunshine", name: "Sunshine", category: "retro", font: "bangers", weight: 400, size: 0.052, color: "#111111", accent: "#dc2626", highlight: "color", uppercase: true, letterSpacing: 0.03, lineHeight: 1.15, box: { color: "#fde047", padX: 0.4, padY: 0.12, radius: 0.12, mode: "line" } },
  { id: "ink", name: "Ink", category: "retro", font: "marker", weight: 400, size: 0.046, color: "#111111", accent: "#1d4ed8", highlight: "color", lineHeight: 1.25, stroke: { color: "#ffffff", width: 0.18 }, shadow: { color: "rgba(0,0,0,0.35)", blur: 0.15, x: 0, y: 0.05 } },
  { id: "lemon", name: "Lemon", category: "retro", font: "inter", weight: 900, size: 0.046, color: "#fde047", accent: "#ffffff", highlight: "scale", uppercase: true, lineHeight: 1.2, stroke: { color: "#000000", width: 0.14 }, shadow: { color: "#000000", blur: 0, x: 0.07, y: 0.07 } },
  { id: "serif", name: "Serif", category: "retro", font: "playfair", weight: 700, italic: true, size: 0.044, color: "#ffffff", accent: "#f59e0b", highlight: "color", lineHeight: 1.3, shadow: { color: "rgba(0,0,0,0.65)", blur: 0.2, x: 0, y: 0.06 } },
];

export const PRESET_CATEGORIES: { id: PresetCategory; name: string }[] = [
  { id: "social", name: "Social" },
  { id: "business", name: "Business" },
  { id: "retro", name: "Retro" },
];

export function getPreset(id: string): CaptionPreset {
  return CAPTION_PRESETS.find((p) => p.id === id) ?? CAPTION_PRESETS[0];
}
