/**
 * The check before an export: what would go wrong, or look wrong, in the file.
 * Missing or unreadable media and an empty project are errors (the export can't
 * finish, or would be blank); text the frame cuts off, fonts that did not load,
 * things that never appear and captions without a translation are warnings.
 *
 * The browser-only parts (storage, fonts, canvas text measuring) come in through
 * `PreflightEnv`, so the rules themselves are plain functions that tests can run.
 */
import type { Ctx, Frame, Rect } from "@/lib/captions/renderer";
import { cueDisplayText, drawCue, layoutTextOverlay } from "@/lib/captions/renderer";
import { getPreset } from "@/lib/captions/presets";
import { FONT_LABELS, fontFamily } from "@/lib/captions/fonts";
import { getFormat } from "@/lib/models/formats";
import { collectAssetIds, type FontKey, type TextOverlay, type VideoProject } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { formatTime } from "@/lib/utils/time";

export type PreflightSeverity = "error" | "warning";

/** What a "Show me" button should do for an issue. */
export interface PreflightTarget {
  tool: "clips" | "trim" | "subtitles" | "style" | "text" | "picture" | "music";
  select?: { kind: "clip" | "cue" | "overlay" | "voiceover"; id: string };
  /** Project time to move the playhead to. */
  time?: number;
}

export interface PreflightIssue {
  id: string;
  severity: PreflightSeverity;
  title: string;
  detail: string;
  target?: PreflightTarget;
}

export interface PreflightEnv {
  /** "ok" when the stored file can be read end to end at both ends, "missing" when nothing is stored, "unreadable" when the browser lost the file behind it. */
  assetState(assetId: string): Promise<"ok" | "missing" | "unreadable">;
  /** The fonts (of those asked for) that did not load, so canvas text would fall back to something else. */
  missingFonts(wanted: { key: FontKey; weight: number; italic: boolean }[]): Promise<FontKey[]>;
  /** A 2D context at the export frame's size, to measure and draw text on. */
  context(frame: Frame): Ctx;
}

export interface PreflightOptions {
  /** Which language the burned-in captions use. */
  captionSource?: "original" | "translated";
  includeCaptions?: boolean;
  includeOverlays?: boolean;
}

const EDGE = 2;

/** True when every side of the rectangle is inside the frame (a couple of pixels of slack for rounding). */
export function insideFrame(r: Rect, frame: Frame): boolean {
  return r.x >= -EDGE && r.y >= -EDGE && r.x + r.w <= frame.width + EDGE && r.y + r.h <= frame.height + EDGE;
}

const list = (items: string[], max = 3) => (items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} and ${items.length - max} more`);

function assetNames(project: VideoProject): Map<string, string> {
  const names = new Map<string, string>();
  for (const c of project.clips) {
    names.set(c.assetId, c.name);
    if (c.audioAssetId) names.set(c.audioAssetId, c.audioLabel || `${c.name} (cleaned audio)`);
    if (c.look?.lutAssetId) names.set(c.look.lutAssetId, c.look.lutName || "a colour look");
    if (c.matte) names.set(c.matte.assetId, `${c.name} (subject cut-out)`);
  }
  if (project.music) names.set(project.music.assetId, project.music.name || "the music track");
  for (const v of project.voiceovers) names.set(v.assetId, v.name || "a voice-over");
  for (const o of project.overlays) if ("assetId" in o) names.set(o.assetId, o.name || "a sticker");
  return names;
}

/** The first moment a text overlay is on screen and the moments its position can change (a motion track). */
function overlayTimes(ov: TextOverlay): number[] {
  if (!ov.track?.keyframes.length) return [ov.start];
  const mid = (ov.start + ov.end) / 2;
  return [ov.start, mid, Math.max(ov.start, ov.end - 0.05)];
}

export async function runPreflight(project: VideoProject, env: PreflightEnv, opts: PreflightOptions = {}): Promise<PreflightIssue[]> {
  const issues: PreflightIssue[] = [];
  const includeCaptions = opts.includeCaptions ?? true;
  const includeOverlays = opts.includeOverlays ?? true;
  const duration = projectDuration(project.clips);

  if (!project.clips.length) {
    return [{ id: "empty", severity: "error", title: "Nothing to export", detail: "The timeline has no clips. Import a video first.", target: { tool: "clips" } }];
  }

  // --- media -----------------------------------------------------------------
  const names = assetNames(project);
  const gone: string[] = [];
  const lost: string[] = [];
  for (const id of collectAssetIds(project)) {
    const state = await env.assetState(id);
    const name = names.get(id) ?? "a media file";
    if (state === "missing") gone.push(name);
    else if (state === "unreadable") lost.push(name);
  }
  if (gone.length) {
    issues.push({ id: "media-missing", severity: "error", title: `${gone.length === 1 ? "A file is" : `${gone.length} files are`} missing from this browser`, detail: `${list(gone)}. Remove ${gone.length === 1 ? "it" : "them"} from the project and add the original again.`, target: { tool: "clips" } });
  }
  if (lost.length) {
    issues.push({ id: "media-unreadable", severity: "error", title: `${lost.length === 1 ? "A file" : `${lost.length} files`} can't be read any more`, detail: `${list(lost)}. The browser lost ${lost.length === 1 ? "its" : "their"} data (cleared site data or disk cleanup). Add the original ${lost.length === 1 ? "file" : "files"} again.`, target: { tool: "clips" } });
  }

  // --- fonts -----------------------------------------------------------------
  const wanted = new Map<string, { key: FontKey; weight: number; italic: boolean }>();
  const want = (key: FontKey, weight: number, italic: boolean) => wanted.set(`${key}/${weight}/${italic}`, { key, weight, italic });
  if (includeOverlays) for (const o of project.overlays) if (o.kind === "text" && o.text.trim()) want(o.fontFamily, o.bold ? 700 : 400, o.italic);
  if (includeCaptions && project.captions.visible && project.cues.length) {
    const preset = getPreset(project.subtitleStyle.presetId);
    want(preset.font, preset.weight, !!preset.italic);
  }
  if (wanted.size) {
    const missing = await env.missingFonts([...wanted.values()]);
    if (missing.length) {
      const labels = [...new Set(missing)].map((k) => FONT_LABELS[k] ?? k);
      issues.push({ id: "fonts", severity: "warning", title: `${labels.length === 1 ? "A font" : "Some fonts"} did not load`, detail: `${list(labels)} did not load, so that text would be drawn in a plain fallback font. Reload the page and check again.`, target: { tool: "text" } });
    }
  }

  // --- text the frame cuts off ----------------------------------------------
  const format = getFormat(project.formatId);
  const frame: Frame = { width: format.width, height: format.height };
  let ctx: Ctx | null = null;
  const context = () => (ctx ??= env.context(frame));

  if (includeOverlays) {
    for (const ov of project.overlays) {
      if (ov.kind !== "text" || !ov.text.trim()) continue;
      const c = context();
      const out = overlayTimes(ov).some((t) => {
        c.save();
        const bounds = layoutTextOverlay(c, ov, frame, t).bounds;
        c.restore();
        // A banner is as wide as the frame by design: only its height can overflow.
        return ov.variant === "banner" ? bounds.y < -EDGE || bounds.y + bounds.h > frame.height + EDGE : !insideFrame(bounds, frame);
      });
      if (out) {
        const label = ov.text.trim().replace(/\s+/g, " ");
        issues.push({
          id: `text-cut-${ov.id}`,
          severity: "warning",
          title: "Text runs past the edge of the picture",
          detail: `“${label.length > 40 ? `${label.slice(0, 40)}…` : label}” is partly outside the frame, so the export cuts it off. Make it smaller, narrower or move it in.`,
          target: { tool: "text", select: { kind: "overlay", id: ov.id }, time: ov.start },
        });
      }
    }
  }
  if (includeCaptions && project.captions.visible && project.cues.length) {
    const c = context();
    const showTranslated = opts.captionSource === "translated" || (opts.captionSource === undefined && project.captions.showTranslated);
    const cut: { start: number; id: string }[] = [];
    for (const cue of project.cues) {
      if (!cueDisplayText(cue, showTranslated).trim()) continue;
      c.save();
      const layout = drawCue(c, cue, project.subtitleStyle, frame, cue.start, { showTranslated });
      c.restore();
      if (layout && !insideFrame(layout.bounds, frame)) cut.push({ start: cue.start, id: cue.id });
    }
    if (cut.length) {
      issues.push({
        id: "captions-cut",
        severity: "warning",
        title: `${cut.length === 1 ? "A caption runs" : `${cut.length} captions run`} past the edge of the picture`,
        detail: `${list(cut.map((x) => formatTime(x.start)))}. Lower the caption size or widen the caption box in Style, or move that caption.`,
        target: { tool: "style", select: { kind: "cue", id: cut[0].id }, time: cut[0].start },
      });
    }
  }

  // --- things that never appear -----------------------------------------------
  if (includeOverlays) {
    const late = project.overlays.filter((o) => o.start >= duration - 0.01);
    if (late.length) {
      issues.push({ id: "overlays-late", severity: "warning", title: `${late.length === 1 ? "An element starts" : `${late.length} elements start`} after the video ends`, detail: `It will never show: it starts at ${formatTime(late[0].start)} and the video is ${formatTime(duration)} long.`, target: { tool: late[0].kind === "text" ? "text" : "picture", select: { kind: "overlay", id: late[0].id } } });
    }
    const blank = project.overlays.filter((o) => o.kind === "text" && !o.text.trim());
    if (blank.length) issues.push({ id: "text-blank", severity: "warning", title: `${blank.length === 1 ? "A text box is" : `${blank.length} text boxes are`} empty`, detail: "Empty text shows nothing. Type something in it or delete it.", target: { tool: "text", select: { kind: "overlay", id: blank[0].id } } });
  }
  if (includeCaptions && project.captions.visible) {
    const late = project.cues.filter((c) => c.start >= duration - 0.01);
    if (late.length) issues.push({ id: "cues-late", severity: "warning", title: `${late.length === 1 ? "A caption comes" : `${late.length} captions come`} after the video ends`, detail: "They will never show. This usually means a clip was trimmed after the captions were made.", target: { tool: "subtitles", select: { kind: "cue", id: late[0].id } } });
  }
  const lateVo = project.voiceovers.filter((v) => v.start >= duration - 0.01);
  if (lateVo.length) issues.push({ id: "voice-late", severity: "warning", title: `${lateVo.length === 1 ? "A voice-over or sound effect starts" : `${lateVo.length} voice-overs or sound effects start`} after the video ends`, detail: "It will not be heard.", target: { tool: "music", select: { kind: "voiceover", id: lateVo[0].id } } });

  // --- captions in the wrong language -----------------------------------------
  if (includeCaptions && project.captions.visible && opts.captionSource === "translated") {
    const untranslated = project.cues.filter((c) => !c.translatedText?.trim());
    if (untranslated.length && project.cues.length) {
      issues.push({ id: "untranslated", severity: "warning", title: `${untranslated.length} of ${project.cues.length} captions have no translation`, detail: "Those captions will show in the original language. Translate them first, or export the original.", target: { tool: "subtitles" } });
    }
  }

  return issues;
}

/** True when the check found something the export cannot get past. */
export function hasBlockingIssue(issues: PreflightIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

// ---------------------------------------------------------------------------
// The real environment: IndexedDB, document.fonts and a canvas
// ---------------------------------------------------------------------------

function firstFamily(stack: string): string {
  return stack.split(",")[0].trim().replace(/^['"]|['"]$/g, "");
}

export function browserPreflightEnv(getAsset: (id: string) => Promise<{ blob: Blob } | undefined>): PreflightEnv {
  return {
    async assetState(id) {
      const record = await getAsset(id);
      if (!record) return "missing";
      const blob = record.blob;
      if (blob.size === 0) return "ok";
      try {
        await Promise.all([blob.slice(0, 1).arrayBuffer(), blob.slice(blob.size - 1).arrayBuffer()]);
        return "ok";
      } catch {
        return "unreadable";
      }
    },
    async missingFonts(wanted) {
      if (typeof document === "undefined" || !("fonts" in document)) return [];
      const missing: FontKey[] = [];
      for (const w of wanted) {
        const stack = fontFamily(w.key);
        try {
          await document.fonts.load(`${w.italic ? "italic " : ""}${w.weight} 24px ${stack}`);
        } catch {
          /* a failed load shows up as no loaded face below */
        }
        const family = firstFamily(stack).toLowerCase();
        let found = false;
        document.fonts.forEach((face) => {
          if (face.status === "loaded" && face.family.replace(/^['"]|['"]$/g, "").toLowerCase() === family) found = true;
        });
        if (!found) missing.push(w.key);
      }
      return missing;
    },
    context(frame) {
      if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(frame.width, frame.height).getContext("2d")!;
      const canvas = document.createElement("canvas");
      canvas.width = frame.width;
      canvas.height = frame.height;
      return canvas.getContext("2d")!;
    },
  };
}

