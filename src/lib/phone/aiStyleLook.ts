/**
 * The style fields of a Story title, and the shape DeepSeek's "Style it" answer takes
 * (desktop/lib/styleAi.mjs on the other side).
 */
import type { FontKey, TextOverlay } from "@/lib/models/project";

/** The fields a suggested look changes on a title; everything else about it stays as it was. */
export type Look = Pick<TextOverlay, "fontFamily" | "color" | "background" | "fontSize" | "bold" | "italic">;

/** One look as the desktop shell sends it back. */
export interface AiStyleReply {
  name: string;
  why: string;
  font: string;
  color: string;
  background: string | null;
  size: number;
  bold: boolean;
  italic: boolean;
}

/** A copy of an overlay's six style fields, so Plain can put them back later. */
export function lookOf(overlay: Look): Look {
  return {
    fontFamily: overlay.fontFamily,
    color: overlay.color,
    background: overlay.background,
    fontSize: overlay.fontSize,
    bold: overlay.bold,
    italic: overlay.italic,
  };
}

/** A reply turned into the fields an overlay takes (font → fontFamily, size → fontSize). */
export function lookFrom(reply: AiStyleReply): Look {
  return {
    fontFamily: reply.font as FontKey,
    color: reply.color,
    background: reply.background,
    fontSize: reply.size,
    bold: reply.bold,
    italic: reply.italic,
  };
}

/** The looks already tried plus this one, one line each, so the next ask is clearly different. */
export function triedList(tried: string[], reply: AiStyleReply): string[] {
  const line = `${reply.name}: ${reply.font} ${reply.color} on ${reply.background ?? "nothing"}`.slice(0, 80);
  return [...tried, line].slice(-12);
}
