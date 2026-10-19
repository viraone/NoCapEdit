/**
 * The timeline as an editing-program project: FCPXML 1.10 (Final Cut Pro,
 * DaVinci Resolve) and xmeml v4, "Final Cut Pro 7 XML" (Premiere Pro,
 * DaVinci Resolve). Pure: it writes text from the project and a table that says
 * where each media file sits in the package; nleBundle.ts packs the files.
 *
 * Every clip, caption, voice-over and the song keep their place in the project's
 * time. The one thing that moves is a transition: a dissolve between two clips
 * overlaps them in the app, while an editor cuts at one point and dissolves
 * around it, so the cut goes to the middle of the overlap (see `planNle`).
 */
import { getFormat } from "@/lib/models/formats";
import { clipPanAt, type Clip, type VideoProject } from "@/lib/models/project";
import { computePlacement } from "@/lib/models/placement";
import { layoutClips } from "@/lib/models/timeline";
import { getPreset } from "@/lib/captions/presets";
import { cueDisplayText } from "@/lib/captions/renderer";

/** A media file in the package, as the exporter knows it. */
export interface NleMedia {
  /** Path inside the package, relative to the project file (e.g. "media/01 Interview.mp4"). */
  path: string;
  /** Length of the file in seconds. */
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
  width?: number;
  height?: number;
}

export interface NleOptions {
  /** Whole frames per second the timeline is cut on: 24, 30 or 60. */
  fps: number;
  /** Where every asset id the project uses sits in the package. */
  media: Record<string, NleMedia>;
}

/** A stretch of picture and sound on the main storyline. */
export interface NleItem {
  clip: Clip;
  media: NleMedia;
  assetId: string;
  /** Timeline frames: the cut in and the cut out. Neighbours share their cut. */
  startF: number;
  endF: number;
  /** Source seconds the item starts at; it plays (endF - startF) / fps * speed from there. */
  srcIn: number;
  /** Dissolve into the next item, in frames (0: a cut). */
  dissolveF: number;
}

/** A sound that sits on its own audio lane: the song or a voice-over / sound effect. */
export interface NleSound {
  kind: "music" | "voice" | "sfx";
  name: string;
  assetId: string;
  media: NleMedia;
  startF: number;
  endF: number;
  srcIn: number;
  volume: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface NleText {
  name: string;
  text: string;
  startF: number;
  endF: number;
  /** Centre of the text as fractions of the frame. */
  x: number;
  y: number;
  /** Size in frame pixels. */
  fontPx: number;
  color: string;
  caption: boolean;
}

export interface NlePlan {
  name: string;
  fps: number;
  width: number;
  height: number;
  durationF: number;
  items: NleItem[];
  sounds: NleSound[];
  texts: NleText[];
  /** What the editor will not show the way the app does, one plain sentence each. */
  notes: string[];
}

export const NLE_FPS = [24, 30, 60] as const;

/** Where the file list stops being a plan and starts being text: the planner throws when a clip's media is not in the table. */
export function planNle(project: VideoProject, opts: NleOptions): NlePlan {
  const fps = opts.fps;
  const frame = getFormat(project.formatId);
  const width = frame.width;
  const height = frame.height;
  const tf = (sec: number) => Math.round(sec * fps);
  const layouts = layoutClips(project.clips);
  const total = layouts.length ? layouts[layouts.length - 1].end : 0;
  const notes: string[] = [];
  const need = (assetId: string) => {
    const m = opts.media[assetId];
    if (!m) throw new Error("A media file used by this project is missing, so the timeline can't be written.");
    return m;
  };

  // The cut between two clips sits in the middle of their overlap, so both keep every frame they show.
  const boundary: number[] = [0];
  for (const l of layouts) boundary.push(tf(l.transitionOut > 0 ? l.end - l.transitionOut / 2 : l.end));
  if (layouts.length) boundary[layouts.length] = tf(total);

  const items: NleItem[] = [];
  layouts.forEach((l, i) => {
    const startF = boundary[i];
    const endF = boundary[i + 1];
    if (endF <= startF) {
      notes.push(`“${l.clip.name}” is under a frame long at ${fps} fps, so it was left out.`);
      return;
    }
    const cutIn = i === 0 ? 0 : l.transitionIn > 0 ? l.start + l.transitionIn / 2 : l.start;
    const srcIn = l.clip.inPoint + Math.max(0, cutIn - l.start) * l.clip.speed;
    const dissolveF = l.transitionOut > 0 ? Math.max(2, tf(l.transitionOut)) : 0;
    items.push({ clip: l.clip, media: need(l.clip.assetId), assetId: l.clip.assetId, startF, endF, srcIn, dissolveF });
  });

  const sounds: NleSound[] = [];
  const music = project.music;
  if (music) {
    const m = need(music.assetId);
    const pieces = music.pieces?.length ?? 0;
    const from = music.pieces?.[0]?.from ?? music.startOffset;
    const fileLeft = Math.max(0, music.duration - from - (pieces ? 0 : (music.endTrim ?? 0)));
    const length = Math.min(total, fileLeft);
    if (pieces > 1) notes.push("The song was cut into pieces; the editor gets its first piece only.");
    else if (music.loop && fileLeft < total - 0.05 && !(music.endTrim ?? 0)) notes.push("The song loops in the app; in the editor it plays once.");
    if (length > 0.05) {
      sounds.push({ kind: "music", name: music.name, assetId: music.assetId, media: m, startF: 0, endF: tf(length), srcIn: from, volume: music.volume, fadeIn: music.fadeIn, fadeOut: music.fadeOut });
    }
  }
  for (const vo of project.voiceovers) {
    const m = need(vo.assetId);
    const startF = tf(vo.start);
    const endF = Math.max(startF + 1, tf(vo.start + vo.duration));
    sounds.push({ kind: vo.kind === "sfx" ? "sfx" : "voice", name: vo.name || (vo.kind === "sfx" ? "Sound effect" : "Voice-over"), assetId: vo.assetId, media: m, startF, endF, srcIn: 0, volume: vo.volume });
  }
  // Noise-removed sound plays instead of the clip's own track: the editor gets it as a separate sound.
  for (const it of items) {
    if (!it.clip.audioAssetId) continue;
    const m = opts.media[it.clip.audioAssetId];
    if (!m) continue;
    sounds.push({ kind: "voice", name: it.clip.audioLabel || `${it.clip.name} (cleaned)`, assetId: it.clip.audioAssetId, media: m, startF: it.startF, endF: it.endF, srcIn: it.srcIn, volume: it.clip.volume });
  }

  const texts: NleText[] = [];
  const style = project.subtitleStyle;
  const preset = getPreset(style.presetId);
  if (project.captions.visible) {
    for (const cue of project.cues) {
      const text = cueDisplayText(cue, project.captions.showTranslated).trim();
      const startF = tf(cue.start);
      const endF = Math.max(startF + 1, tf(cue.end));
      if (!text) continue;
      const anchor = cue.anchor ?? { x: style.x, y: style.y };
      texts.push({ name: text.slice(0, 40), text: style.uppercase ?? preset.uppercase ? text.toUpperCase() : text, startF, endF, x: anchor.x, y: anchor.y, fontPx: Math.round(preset.size * height * style.sizeScale), color: style.textColor ?? preset.color, caption: true });
    }
  }
  let stickers = 0;
  for (const ov of project.overlays) {
    if (ov.kind !== "text") {
      stickers++;
      continue;
    }
    const startF = tf(ov.start);
    texts.push({ name: ov.text.slice(0, 40), text: ov.text, startF, endF: Math.max(startF + 1, tf(ov.end)), x: ov.x, y: ov.y, fontPx: Math.round(ov.fontSize * height), color: ov.color, caption: false });
  }
  if (stickers) notes.push(`${stickers} sticker${stickers === 1 ? "" : "s"} and animation${stickers === 1 ? "" : "s"} are not in the timeline.`);

  if (project.clips.some((c) => c.reframe?.keyframes.length)) notes.push("Auto-reframe moves are written as one fixed position per clip.");
  if (project.clips.some((c) => c.look && (c.look.lutAssetId || c.look.brightness || c.look.contrast !== 1 || c.look.saturation !== 1))) notes.push("Colour looks are not in the timeline.");
  if (project.clips.some((c) => c.matte)) notes.push("The cut-out behind the subject is not in the timeline.");
  if (project.clips.some((c) => c.audioFx && c.audioFx !== "none")) notes.push("Audio presets (Voice, Podcast, Loud, Music) are not in the timeline.");
  if (layouts.some((l) => l.transitionOut > 0 && l.clip.transition.type !== "fade")) notes.push("Every transition becomes a cross dissolve.");
  if (project.cues.length && project.captions.visible) notes.push("Captions come as plain titles; the word-by-word highlight stays in the app (the .srt and .vtt files carry the timing).");

  return { name: project.name, fps, width, height, durationF: tf(total), items, sounds, texts, notes };
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Escapes text for an XML attribute or node and drops the control characters XML 1.0 forbids. */
export function xml(text: string): string {
  return text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (c) => ESC[c]);
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const num = (n: number) => String(round6(n));

/** Linear gain (0..2) as decibels; silence is -96 dB. */
export function gainDb(gain: number): number {
  return gain <= 0.00002 ? -96 : round6(20 * Math.log10(gain));
}

function hexToRgb(color: string): [number, number, number] {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return [1, 1, 1];
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

/** Where a clip's picture lands in the frame, as an editor's "Basic Motion": the source's own pixels times `scale`, its centre moved by (dx, dy) frame pixels (down is positive). */
export function clipMotion(item: NleItem, frame: { width: number; height: number }) {
  const { clip } = item;
  const p = computePlacement({ width: clip.width, height: clip.height }, { zoom: clip.zoom, pan: clipPanAt(clip, item.srcIn) }, frame);
  return {
    scale: p.dw / Math.max(1, clip.width),
    dx: p.dx + p.dw / 2 - frame.width / 2,
    dy: p.dy + p.dh / 2 - frame.height / 2,
  };
}

const SEQ_FORMAT = "r_seq";
const BASIC_TITLE = ".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti";
const CROSS_DISSOLVE = "FxPlug:4731E73A-8DAC-4113-9A30-AE85B1761265";
const AUDIO_CROSSFADE = "FFAudioTransition";

// ---------------------------------------------------------------------------
// FCPXML 1.10
// ---------------------------------------------------------------------------

export function buildFcpxml(plan: NlePlan): string {
  const { fps, width, height } = plan;
  const frames = (f: number) => (f === 0 ? "0s" : `${f}/${fps}s`);
  const sec = (s: number) => (s <= 0 ? "0s" : `${Math.round(s * 90000)}/90000s`);
  const out: string[] = [];
  const res: string[] = [];
  res.push(`    <format id="${SEQ_FORMAT}" name="NoCapEdit${height}p${fps}" frameDuration="1/${fps}s" width="${width}" height="${height}" colorSpace="1-1-1 (Rec. 709)"/>`);

  // One asset per file, one format per picture size.
  const assetIds = new Map<string, string>();
  const formats = new Map<string, string>();
  const addAsset = (assetId: string, m: NleMedia): string => {
    const known = assetIds.get(assetId);
    if (known) return known;
    const id = `r_a${assetIds.size + 1}`;
    assetIds.set(assetId, id);
    let formatAttr = "";
    if (m.hasVideo) {
      const key = `${m.width}x${m.height}`;
      let fid = formats.get(key);
      if (!fid) {
        fid = `r_f${formats.size + 1}`;
        formats.set(key, fid);
        res.push(`    <format id="${fid}" frameDuration="1/${fps}s" width="${m.width ?? width}" height="${m.height ?? height}"/>`);
      }
      formatAttr = ` format="${fid}"`;
    }
    res.push(
      `    <asset id="${id}" name="${xml(m.path.split("/").pop() ?? "media")}" start="0s" duration="${sec(m.duration)}"${m.hasVideo ? ` hasVideo="1"${formatAttr} videoSources="1"` : ""}${m.hasAudio ? ' hasAudio="1" audioSources="1" audioChannels="2" audioRate="48000"' : ""}>`,
      `      <media-rep kind="original-media" src="${xml(encodeURI(m.path))}"/>`,
      "    </asset>",
    );
    return id;
  };
  for (const it of plan.items) addAsset(it.assetId, it.media);
  for (const s of plan.sounds) addAsset(s.assetId, s.media);

  const hasDissolve = plan.items.some((it) => it.dissolveF > 0);
  if (hasDissolve) {
    res.push(`    <effect id="r_dissolve" name="Cross Dissolve" uid="${CROSS_DISSOLVE}"/>`);
    res.push(`    <effect id="r_xfade" name="Audio Crossfade" uid="${AUDIO_CROSSFADE}"/>`);
  }
  if (plan.texts.length) res.push(`    <effect id="r_title" name="Basic Title" uid="${BASIC_TITLE}"/>`);

  /** The spine item a timeline frame falls in; the last one takes what is past the end. */
  const parentAt = (f: number) => plan.items.find((it) => f >= it.startF && f < it.endF) ?? plan.items[plan.items.length - 1];
  /** Connected things count time from the start of the item they hang on: source time, or for a retimed clip, its own output time. */
  const localStart = (it: NleItem) => (Math.abs(it.clip.speed - 1) > 1e-6 ? 0 : it.srcIn);
  const children = new Map<NleItem, string[]>();
  const hang = (it: NleItem, lines: string[]) => children.set(it, [...(children.get(it) ?? []), ...lines]);

  const volume = (gain: number, fadeIn?: number, fadeOut?: number, pad = "") => {
    const lines: string[] = [];
    const fades = (fadeIn ?? 0) > 0.01 || (fadeOut ?? 0) > 0.01;
    if (fades) {
      lines.push(`${pad}<adjust-volume amount="${gainDb(gain)}dB">`, `${pad}  <param name="amount">`);
      if ((fadeIn ?? 0) > 0.01) lines.push(`${pad}    <fadeIn type="easeIn" duration="${sec(fadeIn!)}"/>`);
      if ((fadeOut ?? 0) > 0.01) lines.push(`${pad}    <fadeOut type="easeOut" duration="${sec(fadeOut!)}"/>`);
      lines.push(`${pad}  </param>`, `${pad}</adjust-volume>`);
    } else if (Math.abs(gain - 1) > 1e-3) lines.push(`${pad}<adjust-volume amount="${gainDb(gain)}dB"/>`);
    return lines;
  };

  plan.sounds.forEach((s, i) => {
    const parent = parentAt(s.startF);
    const ref = assetIds.get(s.assetId)!;
    const offset = localStart(parent) + (s.startF - parent.startF) / fps;
    hang(parent, [
      `              <asset-clip ref="${ref}" lane="${-(i + 1)}" offset="${sec(offset)}" name="${xml(s.name)}" start="${sec(s.srcIn)}" duration="${frames(s.endF - s.startF)}" tcFormat="NDF">`,
      ...volume(s.volume, s.fadeIn, s.fadeOut, "                "),
      "              </asset-clip>",
    ]);
  });

  let styleN = 0;
  for (const t of plan.texts) {
    const parent = parentAt(t.startF);
    const offset = localStart(parent) + (t.startF - parent.startF) / fps;
    const sid = `ts${++styleN}`;
    const [r, g, b] = hexToRgb(t.color);
    const px = (t.x - 0.5) * (width / height) * 100;
    const py = -(t.y - 0.5) * 100;
    hang(parent, [
      `              <title ref="r_title" lane="${t.caption ? 2 : 1}" offset="${sec(offset)}" name="${xml(t.name)}" start="0s" duration="${frames(t.endF - t.startF)}">`,
      `                <text><text-style ref="${sid}">${xml(t.text)}</text-style></text>`,
      `                <text-style-def id="${sid}">`,
      `                  <text-style font="Helvetica" fontSize="${Math.max(8, t.fontPx)}" fontFace="Bold" fontColor="${num(r)} ${num(g)} ${num(b)} 1" alignment="center"/>`,
      "                </text-style-def>",
      `                <adjust-transform position="${num(px)} ${num(py)}"/>`,
      "              </title>",
    ]);
  }

  const spine: string[] = [];
  plan.items.forEach((it, i) => {
    const ref = assetIds.get(it.assetId)!;
    const length = it.endF - it.startF;
    const retimed = Math.abs(it.clip.speed - 1) > 1e-6;
    const lines = [`            <asset-clip ref="${ref}" offset="${frames(it.startF)}" name="${xml(it.clip.name)}" start="${retimed ? "0s" : sec(it.srcIn)}" duration="${frames(length)}" tcFormat="NDF"${it.media.hasVideo ? ` format="${SEQ_FORMAT}"` : ""}>`];
    if (retimed) {
      const played = (length / fps) * it.clip.speed;
      lines.push("              <timeMap>", `                <timept time="0s" value="${sec(it.srcIn)}" interp="linear"/>`, `                <timept time="${frames(length)}" value="${sec(it.srcIn + played)}" interp="linear"/>`, "              </timeMap>");
    }
    if (it.media.hasVideo) {
      const m = clipMotion(it, { width, height });
      lines.push('              <adjust-conform type="none"/>');
      if (Math.abs(m.scale - 1) > 1e-4 || Math.abs(m.dx) > 0.5 || Math.abs(m.dy) > 0.5) {
        lines.push(`              <adjust-transform position="${num((m.dx / height) * 100)} ${num((-m.dy / height) * 100)}" scale="${num(m.scale)} ${num(m.scale)}"/>`);
      }
    }
    // The clip's own sound is silent when a cleaned copy plays instead.
    const gain = it.clip.audioAssetId ? 0 : it.clip.hasAudio ? it.clip.volume : 1;
    lines.push(...volume(gain, undefined, undefined, "              "));
    lines.push(...(children.get(it) ?? []), "            </asset-clip>");
    spine.push(...lines);
    if (it.dissolveF > 0 && plan.items[i + 1]) {
      const half = Math.round(it.dissolveF / 2);
      spine.push(
        `            <transition name="Cross Dissolve" offset="${frames(it.endF - half)}" duration="${frames(it.dissolveF)}">`,
        '              <filter-video ref="r_dissolve" name="Cross Dissolve"/>',
        '              <filter-audio ref="r_xfade" name="Audio Crossfade"/>',
        "            </transition>",
      );
    }
  });

  out.push(
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE fcpxml>",
    '<fcpxml version="1.10">',
    "  <resources>",
    ...res,
    "  </resources>",
    "  <library>",
    `    <event name="${xml(plan.name)}">`,
    `      <project name="${xml(plan.name)}">`,
    `        <sequence format="${SEQ_FORMAT}" duration="${frames(plan.durationF)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    "          <spine>",
    ...spine,
    "          </spine>",
    "        </sequence>",
    "      </project>",
    "    </event>",
    "  </library>",
    "</fcpxml>",
    "",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// xmeml v4 (Final Cut Pro 7 XML): Premiere Pro, DaVinci Resolve
// ---------------------------------------------------------------------------

export function buildXmeml(plan: NlePlan): string {
  const { fps, width, height } = plan;
  const rate = (pad: string) => `${pad}<rate>\n${pad}  <timebase>${fps}</timebase>\n${pad}  <ntsc>FALSE</ntsc>\n${pad}</rate>`;
  const timecode = (pad: string) => [`${pad}<timecode>`, rate(`${pad}  `), `${pad}  <string>00:00:00:00</string>`, `${pad}  <frame>0</frame>`, `${pad}  <displayformat>NDF</displayformat>`, `${pad}</timecode>`].join("\n");
  const written = new Set<string>();
  const fileIds = new Map<string, string>();
  const fileXml = (assetId: string, m: NleMedia, pad: string): string => {
    let id = fileIds.get(assetId);
    if (!id) {
      id = `file-${fileIds.size + 1}`;
      fileIds.set(assetId, id);
    }
    if (written.has(id)) return `${pad}<file id="${id}"/>`;
    written.add(id);
    const lines = [
      `${pad}<file id="${id}">`,
      `${pad}  <name>${xml(m.path.split("/").pop() ?? "media")}</name>`,
      `${pad}  <pathurl>${xml(encodeURI(m.path))}</pathurl>`,
      rate(`${pad}  `),
      `${pad}  <duration>${Math.max(1, Math.round(m.duration * fps))}</duration>`,
      timecode(`${pad}  `),
      `${pad}  <media>`,
    ];
    if (m.hasVideo) {
      lines.push(`${pad}    <video>`, `${pad}      <samplecharacteristics>`, rate(`${pad}        `), `${pad}        <width>${m.width ?? width}</width>`, `${pad}        <height>${m.height ?? height}</height>`, `${pad}        <anamorphic>FALSE</anamorphic>`, `${pad}        <pixelaspectratio>square</pixelaspectratio>`, `${pad}        <fielddominance>none</fielddominance>`, `${pad}      </samplecharacteristics>`, `${pad}    </video>`);
    }
    if (m.hasAudio) {
      lines.push(`${pad}    <audio>`, `${pad}      <samplecharacteristics>`, `${pad}        <depth>16</depth>`, `${pad}        <samplerate>48000</samplerate>`, `${pad}      </samplecharacteristics>`, `${pad}      <channelcount>2</channelcount>`, `${pad}    </audio>`);
    }
    lines.push(`${pad}  </media>`, `${pad}</file>`);
    return lines.join("\n");
  };
  const levels = (gain: number, pad: string) =>
    [
      `${pad}<filter>`,
      `${pad}  <effect>`,
      `${pad}    <name>Audio Levels</name>`,
      `${pad}    <effectid>audiolevels</effectid>`,
      `${pad}    <effectcategory>audiolevels</effectcategory>`,
      `${pad}    <effecttype>audiolevels</effecttype>`,
      `${pad}    <mediatype>audio</mediatype>`,
      `${pad}    <parameter>`,
      `${pad}      <parameterid>level</parameterid>`,
      `${pad}      <name>Level</name>`,
      `${pad}      <valuemin>0</valuemin>`,
      `${pad}      <valuemax>3.98109</valuemax>`,
      `${pad}      <value>${num(Math.min(3.98109, gain))}</value>`,
      `${pad}    </parameter>`,
      `${pad}  </effect>`,
      `${pad}</filter>`,
    ].join("\n");
  const basicMotion = (scale: number, h: number, v: number, pad: string) =>
    [
      `${pad}<filter>`,
      `${pad}  <effect>`,
      `${pad}    <name>Basic Motion</name>`,
      `${pad}    <effectid>basic</effectid>`,
      `${pad}    <effectcategory>motion</effectcategory>`,
      `${pad}    <effecttype>motion</effecttype>`,
      `${pad}    <mediatype>video</mediatype>`,
      `${pad}    <parameter>`,
      `${pad}      <parameterid>scale</parameterid>`,
      `${pad}      <name>Scale</name>`,
      `${pad}      <valuemin>0</valuemin>`,
      `${pad}      <valuemax>1000</valuemax>`,
      `${pad}      <value>${num(scale * 100)}</value>`,
      `${pad}    </parameter>`,
      `${pad}    <parameter>`,
      `${pad}      <parameterid>center</parameterid>`,
      `${pad}      <name>Center</name>`,
      `${pad}      <value>`,
      `${pad}        <horiz>${num(h)}</horiz>`,
      `${pad}        <vert>${num(v)}</vert>`,
      `${pad}      </value>`,
      `${pad}    </parameter>`,
      `${pad}  </effect>`,
      `${pad}</filter>`,
    ].join("\n");
  const timeRemap = (speed: number, pad: string) =>
    [
      `${pad}<filter>`,
      `${pad}  <effect>`,
      `${pad}    <name>Time Remap</name>`,
      `${pad}    <effectid>timeremap</effectid>`,
      `${pad}    <effectcategory>motion</effectcategory>`,
      `${pad}    <effecttype>motion</effecttype>`,
      `${pad}    <mediatype>video</mediatype>`,
      `${pad}    <parameter>`,
      `${pad}      <parameterid>variablespeed</parameterid>`,
      `${pad}      <name>variablespeed</name>`,
      `${pad}      <valuemin>0</valuemin>`,
      `${pad}      <valuemax>1</valuemax>`,
      `${pad}      <value>0</value>`,
      `${pad}    </parameter>`,
      `${pad}    <parameter>`,
      `${pad}      <parameterid>speed</parameterid>`,
      `${pad}      <name>speed</name>`,
      `${pad}      <valuemin>-100000</valuemin>`,
      `${pad}      <valuemax>100000</valuemax>`,
      `${pad}      <value>${num(speed * 100)}</value>`,
      `${pad}    </parameter>`,
      `${pad}  </effect>`,
      `${pad}</filter>`,
    ].join("\n");

  const p = "        ";
  const srcFrames = (sec: number) => Math.round(sec * fps);
  const videoClips: string[] = [];
  const audioOfClips: string[] = [];
  plan.items.forEach((it, i) => {
    const length = it.endF - it.startF;
    const speed = it.clip.speed;
    const inF = srcFrames(it.srcIn);
    const outF = inF + Math.max(1, Math.round(length * speed));
    const idV = `clipitem-v${i + 1}`;
    const idA = `clipitem-a${i + 1}`;
    const common = (id: string, pad: string) => [
      `${pad}<clipitem id="${id}">`,
      `${pad}  <name>${xml(it.clip.name)}</name>`,
      `${pad}  <enabled>TRUE</enabled>`,
      `${pad}  <duration>${Math.max(1, Math.round(it.media.duration * fps))}</duration>`,
      rate(`${pad}  `),
      `${pad}  <start>${it.startF}</start>`,
      `${pad}  <end>${it.endF}</end>`,
      `${pad}  <in>${inF}</in>`,
      `${pad}  <out>${outF}</out>`,
    ];
    const link = (pad: string) => {
      const lines = [`${pad}<link>`, `${pad}  <linkclipref>${idV}</linkclipref>`, `${pad}  <mediatype>video</mediatype>`, `${pad}  <trackindex>1</trackindex>`, `${pad}  <clipindex>${i + 1}</clipindex>`, `${pad}</link>`];
      if (it.media.hasAudio && !it.clip.audioAssetId) lines.push(`${pad}<link>`, `${pad}  <linkclipref>${idA}</linkclipref>`, `${pad}  <mediatype>audio</mediatype>`, `${pad}  <trackindex>1</trackindex>`, `${pad}  <clipindex>${i + 1}</clipindex>`, `${pad}  <groupindex>1</groupindex>`, `${pad}</link>`);
      return lines;
    };
    if (it.media.hasVideo) {
      const m = clipMotion(it, { width, height });
      const v = [...common(idV, `${p}  `), `${p}    <alphatype>none</alphatype>`, `${p}    <pixelaspectratio>square</pixelaspectratio>`, `${p}    <anamorphic>FALSE</anamorphic>`, fileXml(it.assetId, it.media, `${p}    `)];
      if (Math.abs(speed - 1) > 1e-6) v.push(timeRemap(speed, `${p}    `));
      v.push(basicMotion(m.scale, m.dx / width, m.dy / height, `${p}    `), ...link(`${p}    `), `${p}  </clipitem>`);
      videoClips.push(v.join("\n"));
      if (it.dissolveF > 0 && plan.items[i + 1]) {
        const half = Math.round(it.dissolveF / 2);
        videoClips.push(
          [
            `${p}  <transitionitem>`,
            `${p}    <start>${it.endF - half}</start>`,
            `${p}    <end>${it.endF - half + it.dissolveF}</end>`,
            `${p}    <alignment>center</alignment>`,
            `${p}    <effect>`,
            `${p}      <name>Cross Dissolve</name>`,
            `${p}      <effectid>Cross Dissolve</effectid>`,
            `${p}      <effectcategory>Dissolve</effectcategory>`,
            `${p}      <effecttype>transition</effecttype>`,
            `${p}      <mediatype>video</mediatype>`,
            `${p}      <wipecode>0</wipecode>`,
            `${p}      <wipeaccuracy>100</wipeaccuracy>`,
            `${p}      <startratio>0</startratio>`,
            `${p}      <endratio>1</endratio>`,
            `${p}      <reverse>FALSE</reverse>`,
            `${p}    </effect>`,
            `${p}  </transitionitem>`,
          ].join("\n"),
        );
      }
    }
    if (it.media.hasAudio && !it.clip.audioAssetId) {
      const a = [...common(idA, `${p}  `), fileXml(it.assetId, it.media, `${p}    `)];
      if (Math.abs(speed - 1) > 1e-6) a.push(timeRemap(speed, `${p}    `));
      a.push(`${p}    <sourcetrack>`, `${p}      <mediatype>audio</mediatype>`, `${p}      <trackindex>1</trackindex>`, `${p}    </sourcetrack>`, levels(it.clip.volume, `${p}    `), ...link(`${p}    `), `${p}  </clipitem>`);
      audioOfClips.push(a.join("\n"));
    }
  });

  const soundTrack = (s: NleSound, n: number) =>
    [
      `${p}<track premiereTrackType="Stereo">`,
      `${p}  <clipitem id="clipitem-s${n}">`,
      `${p}    <name>${xml(s.name)}</name>`,
      `${p}    <enabled>TRUE</enabled>`,
      `${p}    <duration>${Math.max(1, Math.round(s.media.duration * fps))}</duration>`,
      rate(`${p}    `),
      `${p}    <start>${s.startF}</start>`,
      `${p}    <end>${s.endF}</end>`,
      `${p}    <in>${srcFrames(s.srcIn)}</in>`,
      `${p}    <out>${srcFrames(s.srcIn) + (s.endF - s.startF)}</out>`,
      fileXml(s.assetId, s.media, `${p}      `),
      `${p}    <sourcetrack>`,
      `${p}      <mediatype>audio</mediatype>`,
      `${p}      <trackindex>1</trackindex>`,
      `${p}    </sourcetrack>`,
      levels(s.volume, `${p}    `),
      `${p}  </clipitem>`,
      `${p}  <enabled>TRUE</enabled>`,
      `${p}  <locked>FALSE</locked>`,
      `${p}</track>`,
    ].join("\n");

  const audioTracks: string[] = [];
  if (audioOfClips.length) audioTracks.push([`${p}<track premiereTrackType="Stereo">`, ...audioOfClips, `${p}  <enabled>TRUE</enabled>`, `${p}  <locked>FALSE</locked>`, `${p}</track>`].join("\n"));
  plan.sounds.forEach((s, i) => audioTracks.push(soundTrack(s, i + 1)));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<!DOCTYPE xmeml>",
    '<xmeml version="4">',
    '  <sequence id="sequence-1">',
    `    <name>${xml(plan.name)}</name>`,
    `    <duration>${plan.durationF}</duration>`,
    rate("    "),
    timecode("    "),
    "    <in>-1</in>",
    "    <out>-1</out>",
    "    <media>",
    "      <video>",
    `${p}<format>`,
    `${p}  <samplecharacteristics>`,
    rate(`${p}    `),
    `${p}    <width>${width}</width>`,
    `${p}    <height>${height}</height>`,
    `${p}    <anamorphic>FALSE</anamorphic>`,
    `${p}    <pixelaspectratio>square</pixelaspectratio>`,
    `${p}    <fielddominance>none</fielddominance>`,
    `${p}  </samplecharacteristics>`,
    `${p}</format>`,
    `${p}<track>`,
    ...videoClips,
    `${p}  <enabled>TRUE</enabled>`,
    `${p}  <locked>FALSE</locked>`,
    `${p}</track>`,
    "      </video>",
    "      <audio>",
    `${p}<numOutputChannels>2</numOutputChannels>`,
    `${p}<format>`,
    `${p}  <samplecharacteristics>`,
    `${p}    <depth>16</depth>`,
    `${p}    <samplerate>48000</samplerate>`,
    `${p}  </samplecharacteristics>`,
    `${p}</format>`,
    ...audioTracks,
    "      </audio>",
    "    </media>",
    "  </sequence>",
    "</xmeml>",
    "",
  ].join("\n");
}
