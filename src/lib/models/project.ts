import { uid } from "@/lib/utils/id";
import { DEFAULT_FORMAT_ID, getFormat, type SafeZoneKind } from "./formats";

export const PROJECT_VERSION = 1;

export type NativeTransitionType =
  | "none"
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown";

/** Native xfade transitions plus GPU shader transitions (`glsl:*`). */
export type TransitionType = NativeTransitionType | `glsl:${string}`;

export const TRANSITIONS: { id: TransitionType; name: string }[] = [
  { id: "none", name: "Cut" },
  { id: "fade", name: "Crossfade" },
  { id: "fadeblack", name: "Fade through black" },
  { id: "fadewhite", name: "Fade through white" },
  { id: "wipeleft", name: "Wipe left" },
  { id: "wiperight", name: "Wipe right" },
  { id: "wipeup", name: "Wipe up" },
  { id: "wipedown", name: "Wipe down" },
  { id: "slideleft", name: "Slide left" },
  { id: "slideright", name: "Slide right" },
  { id: "slideup", name: "Slide up" },
  { id: "slidedown", name: "Slide down" },
  { id: "glsl:crosszoom", name: "Cross zoom (GPU)" },
  { id: "glsl:radial", name: "Radial sweep (GPU)" },
  { id: "glsl:directionalwarp", name: "Directional warp (GPU)" },
  { id: "glsl:glitch", name: "Glitch (GPU)" },
  { id: "glsl:circleopen", name: "Circle open (GPU)" },
  { id: "glsl:pixelize", name: "Pixelize (GPU)" },
  { id: "glsl:swirl", name: "Swirl (GPU)" },
  { id: "glsl:cube", name: "Cube (GPU)" },
  { id: "glsl:dreamy", name: "Dreamy waves (GPU)" },
  { id: "glsl:ripple", name: "Ripple (GPU)" },
];

export interface Keyframe {
  /** Time in seconds (source time for clips, project time for overlays). */
  t: number;
  x: number;
  y: number;
}

/** Motion-tracked path an overlay follows, plus its offset from the tracked point. */
export interface MotionTrack {
  keyframes: Keyframe[];
  offset: { x: number; y: number };
}

/** Animated pan (auto-reframe) keyed on clip source time. */
export interface Reframe {
  keyframes: Keyframe[];
  label?: string;
}

export interface Clip {
  id: string;
  /** Key of the source video Blob in IndexedDB. */
  assetId: string;
  name: string;
  /** Source duration in seconds. */
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  inPoint: number;
  outPoint: number;
  /** Playback speed 0.25x to 4x. */
  speed: number;
  /** Keep the voice pitch when changing speed (atempo) or shift it (asetrate). */
  preservePitch: boolean;
  /** Crop zoom 0.5x to 4x relative to a "cover" fit of the frame. */
  zoom: number;
  /** Pan offset as a fraction of the frame size, -1..1. */
  pan: { x: number; y: number };
  /** Clip audio gain 0..2. */
  volume: number;
  /** Colour of the bands shown when the picture does not cover the frame. */
  background: string;
  /** Transition into the next clip. */
  transition: { type: TransitionType; duration: number };
  /** Replacement audio (e.g. denoised WAV) that plays instead of the clip's own track. */
  audioAssetId?: string | null;
  audioLabel?: string | null;
  /** Animated pan produced by auto-reframing. */
  reframe?: Reframe | null;
  /** Audio enhancement preset (see lib/audio/fx.ts). */
  audioFx?: "none" | "voice" | "podcast" | "loud" | "music";
  /** Colour grade: optional 3D LUT asset plus ffmpeg-eq style adjustments. */
  look?: ClipLook | null;
  /** Subject cut-out masks produced by the matting pass. */
  matte?: ClipMatte | null;
}

export interface ClipMatte {
  assetId: string;
  width: number;
  height: number;
  fps: number;
  count: number;
  /** Source range the masks were computed for. */
  inPoint: number;
  outPoint: number;
}

export interface ClipLook {
  lutAssetId: string | null;
  lutName: string | null;
  /** -1..1, 0 = neutral (ffmpeg eq brightness). */
  brightness: number;
  /** 0..2, 1 = neutral. */
  contrast: number;
  /** 0..3, 1 = neutral. */
  saturation: number;
}

export const NEUTRAL_LOOK: ClipLook = { lutAssetId: null, lutName: null, brightness: 0, contrast: 1, saturation: 1 };

export function isNeutralLook(look: ClipLook | null | undefined): boolean {
  return !look || (!look.lutAssetId && Math.abs(look.brightness) < 1e-3 && Math.abs(look.contrast - 1) < 1e-3 && Math.abs(look.saturation - 1) < 1e-3);
}

export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface CaptionCue {
  id: string;
  /** Project timeline seconds. */
  start: number;
  end: number;
  text: string;
  translatedText?: string;
  /** Word timings (project timeline) used for the active-word highlight. */
  words?: WordTiming[];
  /** Detached position (fractions of the frame). Null = follows the global style position. */
  anchor?: { x: number; y: number } | null;
  /** Speaker index from diarization (0-based), when known. */
  speaker?: number;
}

export type FontKey =
  | "inter"
  | "montserrat"
  | "bangers"
  | "playfair"
  | "bebas"
  | "courier"
  | "marker"
  | "grotesk";

export interface TextOverlay {
  id: string;
  kind: "text";
  variant: "title" | "banner";
  text: string;
  start: number;
  end: number;
  /** Centre position as fractions of the frame. */
  x: number;
  y: number;
  /** Font size as a fraction of the frame height. */
  fontSize: number;
  fontFamily: FontKey;
  color: string;
  background: string | null;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  opacity: number;
  rotation: number;
  /** Max text width as a fraction of the frame width. */
  maxWidth: number;
  track?: MotionTrack | null;
  /** Entrance animation (rendered per frame; exported through the compositor). */
  animation?: TextAnimation;
  layer?: OverlayLayer;
}

export type TextAnimation = "none" | "pop" | "typewriter" | "slide" | "bounce";
/** "behind" draws under the (matted) video, "front" above it. */
export type OverlayLayer = "front" | "behind";

export interface ImageOverlay {
  id: string;
  kind: "image";
  assetId: string;
  name: string;
  start: number;
  end: number;
  x: number;
  y: number;
  /** Width as a fraction of the frame width. Height follows the aspect ratio. */
  width: number;
  aspect: number;
  opacity: number;
  rotation: number;
  track?: MotionTrack | null;
  layer?: OverlayLayer;
}

export interface LottieOverlay {
  id: string;
  kind: "lottie";
  assetId: string;
  name: string;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  aspect: number;
  opacity: number;
  rotation: number;
  loop: boolean;
  speed: number;
  track?: MotionTrack | null;
  layer?: OverlayLayer;
}

export type Overlay = TextOverlay | ImageOverlay | LottieOverlay;

export function createLottieOverlay(init: Pick<LottieOverlay, "assetId" | "name">, start: number, end: number): LottieOverlay {
  return { id: uid("lot"), kind: "lottie", start, end, x: 0.5, y: 0.5, width: 0.5, aspect: 1, opacity: 1, rotation: 0, loop: true, speed: 1, ...init };
}

/** Generated (TTS) voice-over or sound effect placed on the timeline. */
export interface Voiceover {
  id: string;
  kind?: "voice" | "sfx";
  assetId: string;
  name: string;
  text: string;
  start: number;
  duration: number;
  volume: number;
  language?: string;
}

export interface MusicTrack {
  assetId: string;
  name: string;
  duration: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  /** Seconds trimmed from the head of the music file. */
  startOffset: number;
  loop: boolean;
}

export interface SubtitleStyle {
  presetId: string;
  /** Multiplier on the preset's font size. */
  sizeScale: number;
  /** Vertical anchor of the caption group as a fraction of the frame height. */
  y: number;
  x: number;
  accentColor: string | null;
  textColor: string | null;
  highlight: boolean;
  uppercase: boolean | null;
  /** Max caption width as a fraction of the frame width. */
  maxWidth: number;
  /** Colour captions per detected speaker. */
  speakerColors: boolean;
  /** Append keyword emoji (null = preset default). */
  emoji: boolean | null;
}

export interface CaptionSettings {
  visible: boolean;
  showTranslated: boolean;
  sourceLanguage: string;
  targetLanguage: string;
}

export interface VideoProject {
  id: string;
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  formatId: string;
  clips: Clip[];
  cues: CaptionCue[];
  overlays: Overlay[];
  voiceovers: Voiceover[];
  music: MusicTrack | null;
  subtitleStyle: SubtitleStyle;
  captions: CaptionSettings;
  safeZone: SafeZoneKind;
}

export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 4;

export function createProject(partial: Partial<VideoProject> = {}): VideoProject {
  const now = Date.now();
  const formatId = partial.formatId ?? DEFAULT_FORMAT_ID;
  return {
    id: uid("prj"),
    version: PROJECT_VERSION,
    name: "Untitled reel",
    createdAt: now,
    updatedAt: now,
    formatId,
    clips: [],
    cues: [],
    overlays: [],
    voiceovers: [],
    music: null,
    subtitleStyle: defaultSubtitleStyle(),
    captions: { visible: true, showTranslated: false, sourceLanguage: "auto", targetLanguage: "es" },
    safeZone: getFormat(formatId).safeZone,
    ...partial,
  };
}

export function defaultSubtitleStyle(): SubtitleStyle {
  return {
    presetId: "clean",
    sizeScale: 1,
    y: 0.72,
    x: 0.5,
    accentColor: null,
    textColor: null,
    highlight: true,
    uppercase: null,
    maxWidth: 0.86,
    speakerColors: false,
    emoji: null,
  };
}

export function createClip(init: Pick<Clip, "assetId" | "name" | "duration" | "width" | "height" | "hasAudio">): Clip {
  return {
    id: uid("clip"),
    inPoint: 0,
    outPoint: init.duration,
    speed: 1,
    preservePitch: true,
    zoom: 1,
    pan: { x: 0, y: 0 },
    volume: 1,
    background: "#000000",
    transition: { type: "none", duration: 0.5 },
    ...init,
  };
}

export function createTextOverlay(variant: "title" | "banner", start: number, end: number): TextOverlay {
  const isTitle = variant === "title";
  return {
    id: uid("txt"),
    kind: "text",
    variant,
    text: isTitle ? "Your title" : "Banner text",
    start,
    end,
    x: 0.5,
    y: isTitle ? 0.22 : 0.86,
    fontSize: isTitle ? 0.05 : 0.03,
    fontFamily: isTitle ? "montserrat" : "inter",
    color: "#ffffff",
    background: isTitle ? null : "#ef4444",
    bold: true,
    italic: false,
    align: "center",
    opacity: 1,
    rotation: 0,
    maxWidth: isTitle ? 0.85 : 1,
  };
}

export function createImageOverlay(
  init: Pick<ImageOverlay, "assetId" | "name" | "aspect">,
  start: number,
  end: number,
): ImageOverlay {
  return {
    id: uid("img"),
    kind: "image",
    start,
    end,
    x: 0.5,
    y: 0.4,
    width: 0.4,
    opacity: 1,
    rotation: 0,
    ...init,
  };
}

/** Upgrades older stored projects so every field exists. */
export function normalizeProject(raw: VideoProject): VideoProject {
  const base = createProject();
  const project: VideoProject = { ...base, ...raw };
  project.subtitleStyle = { ...base.subtitleStyle, ...(raw.subtitleStyle ?? {}) };
  project.captions = { ...base.captions, ...(raw.captions ?? {}) };
  project.clips = (raw.clips ?? []).map((c) => ({
    ...createClip({ assetId: c.assetId, name: c.name, duration: c.duration, width: c.width, height: c.height, hasAudio: c.hasAudio ?? true }),
    ...c,
    pan: c.pan ?? { x: 0, y: 0 },
    background: c.background ?? "#000000",
    audioFx: c.audioFx ?? "none",
    look: c.look ?? null,
    matte: c.matte ?? null,
    transition: c.transition ?? { type: "none", duration: 0.5 },
  }));
  project.cues = raw.cues ?? [];
  project.overlays = raw.overlays ?? [];
  project.voiceovers = raw.voiceovers ?? [];
  project.music = raw.music ?? null;
  return project;
}

/** Linear interpolation along keyframes (clamped at both ends). */
export function positionAt(keyframes: Keyframe[], t: number): { x: number; y: number } {
  if (!keyframes.length) return { x: 0, y: 0 };
  if (t <= keyframes[0].t) return { x: keyframes[0].x, y: keyframes[0].y };
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y };
  let lo = 0;
  let hi = keyframes.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = keyframes[lo];
  const b = keyframes[hi];
  const f = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

/** Centre of an overlay at project time `t` (follows its motion track when present). */
export function overlayCenter(ov: Overlay, t: number): { x: number; y: number } {
  if (ov.track && ov.track.keyframes.length) {
    const p = positionAt(ov.track.keyframes, t);
    return { x: p.x + ov.track.offset.x, y: p.y + ov.track.offset.y };
  }
  return { x: ov.x, y: ov.y };
}

/** Pan of a clip at a given source time (auto-reframe keyframes override the static pan). */
export function clipPanAt(clip: Clip, sourceTime: number): { x: number; y: number } {
  if (clip.reframe && clip.reframe.keyframes.length) return positionAt(clip.reframe.keyframes, sourceTime);
  return clip.pan;
}
