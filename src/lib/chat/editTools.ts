import type { ToolDef, ToolResult } from "./toolTypes";
import type { VideoProject } from "@/lib/models/project";
import { projectDuration } from "@/lib/models/timeline";
import { moveClip, removeClip, splitClipAt } from "@/lib/models/clipOps";
import { applyRemovals, type TimeRange } from "@/lib/edit/magicCut";
import { formatTime } from "./projectContext";

export const EDIT_TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "transcribe",
      description: "Makes captions and a transcript for the whole reel on this device. Takes a few minutes. Use it first when you need to know what is said and the project has no transcript.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "cut_ranges",
      description: "Removes these time ranges from the reel and closes the gaps. Put EVERY part to remove in this one call; the times are the reel as it is right now. Never call it twice for the same part. Use it to cut out speech, mistakes or any part.",
      parameters: {
        type: "object",
        properties: {
          ranges: {
            type: "array",
            items: {
              type: "object",
              properties: {
                start: { type: "number" },
                end: { type: "number" },
              },
              required: ["start", "end"],
            },
          },
        },
        required: ["ranges"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "split_at",
      description: "Splits the clip under this reel time into two.",
      parameters: {
        type: "object",
        properties: { time: { type: "number" } },
        required: ["time"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_clip",
      description: "Deletes a whole clip.",
      parameters: {
        type: "object",
        properties: { clip_id: { type: "string" } },
        required: ["clip_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "move_clip",
      description: "Moves a clip one place earlier or later in the sequence.",
      parameters: {
        type: "object",
        properties: {
          clip_id: { type: "string" },
          direction: { type: "string", enum: ["earlier", "later"] },
        },
        required: ["clip_id", "direction"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_clip_speed",
      description: "Sets playback speed of a clip, from 0.25 to 4.",
      parameters: {
        type: "object",
        properties: {
          clip_id: { type: "string" },
          speed: { type: "number" },
        },
        required: ["clip_id", "speed"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_caption_text",
      description: "Changes the text of one caption.",
      parameters: {
        type: "object",
        properties: {
          cue_id: { type: "string" },
          text: { type: "string" },
        },
        required: ["cue_id", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_caption",
      description: "Deletes one caption.",
      parameters: {
        type: "object",
        properties: { cue_id: { type: "string" } },
        required: ["cue_id"],
      },
    },
  },
];

/**
 * Tools that change the clips, so the editor must run them with its "ripple" option to move captions and
 * overlays with the picture. cut_ranges is not here: applyRemovals already re-times them, and doing it twice would shift them.
 */
const RIPPLE_TOOLS = new Set(["split_at", "remove_clip", "move_clip", "set_clip_speed"]);

export function toolNeedsRipple(name: string): boolean {
  return RIPPLE_TOOLS.has(name);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Runs one edit tool on the draft project, mutating it. Never throws. */
export function runEditTool(p: VideoProject, name: string, args: unknown): ToolResult {
  if (name === "transcribe") return { ok: false, message: "transcribe is handled by the editor, not here" };
  if (!isRecord(args)) return { ok: false, message: "Arguments must be an object." };
  switch (name) {
    case "cut_ranges": {
      const raw = args.ranges;
      if (!Array.isArray(raw)) return { ok: false, message: "ranges must be an array." };
      const duration = projectDuration(p.clips);
      const ranges: TimeRange[] = [];
      for (const r of raw) {
        if (!isRecord(r)) continue;
        const s = r.start;
        const e = r.end;
        if (typeof s !== "number" || typeof e !== "number" || !Number.isFinite(s) || !Number.isFinite(e)) continue;
        const start = Math.max(0, Math.min(duration, s));
        const end = Math.max(0, Math.min(duration, e));
        if (end - start >= 0.05) ranges.push({ start, end, kind: "custom" });
      }
      if (!ranges.length) return { ok: false, message: `No valid range to cut. The reel is ${duration.toFixed(1)} s long.` };
      const stats = applyRemovals(p, ranges);
      const newTotal = projectDuration(p.clips);
      const label = ranges.length === 1 ? `Cut ${formatTime(ranges[0].start)}–${formatTime(ranges[0].end)}` : `Cut ${ranges.length} parts (${stats.removedSeconds.toFixed(1)} s)`;
      return { ok: true, message: `Removed ${stats.removedSeconds.toFixed(1)} s. The reel is now ${formatTime(newTotal)} (${newTotal.toFixed(1)} s) long.`, label };
    }
    case "split_at": {
      const time = args.time;
      if (typeof time !== "number" || !Number.isFinite(time)) return { ok: false, message: "time must be a number." };
      const id = splitClipAt(p, time);
      if (!id) return { ok: false, message: `Cannot split at ${formatTime(time)}: it is outside the clips, inside a transition, or within 0.1 s of a clip edge.` };
      return { ok: true, message: `Split at ${formatTime(time)}. The new clip id is ${id}.`, label: `Split at ${formatTime(time)}` };
    }
    case "remove_clip": {
      const id = args.clip_id;
      if (typeof id !== "string") return { ok: false, message: "clip_id must be a string." };
      const idx = p.clips.findIndex((c) => c.id === id);
      if (idx < 0) return { ok: false, message: `No clip with id ${id}.` };
      const n = idx + 1;
      const { clearedCaptions } = removeClip(p, id);
      const newTotal = projectDuration(p.clips);
      let message = `Removed the clip. The reel is now ${formatTime(newTotal)} (${newTotal.toFixed(1)} s) long.`;
      if (clearedCaptions > 0) message += ` Its ${clearedCaptions} caption${clearedCaptions === 1 ? "" : "s"} were cleared.`;
      return { ok: true, message, label: `Removed clip ${n}` };
    }
    case "move_clip": {
      const id = args.clip_id;
      const dir = args.direction;
      if (typeof id !== "string") return { ok: false, message: "clip_id must be a string." };
      if (dir !== "earlier" && dir !== "later") return { ok: false, message: "direction must be 'earlier' or 'later'." };
      if (!moveClip(p, id, dir === "earlier" ? -1 : 1)) return { ok: false, message: "Cannot move it that way (already first or last, or no such clip)." };
      return { ok: true, message: `Moved the clip ${dir}.`, label: `Moved clip ${dir}` };
    }
    case "set_clip_speed": {
      const id = args.clip_id;
      const speed = args.speed;
      if (typeof id !== "string") return { ok: false, message: "clip_id must be a string." };
      if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0.25 || speed > 4) return { ok: false, message: "speed must be a number from 0.25 to 4." };
      const clip = p.clips.find((c) => c.id === id);
      if (!clip) return { ok: false, message: `No clip with id ${id}.` };
      clip.speed = speed;
      const newTotal = projectDuration(p.clips);
      return { ok: true, message: `Set the clip speed to ${speed}x. The reel is now ${formatTime(newTotal)} (${newTotal.toFixed(1)} s) long.`, label: `Clip speed ${speed}x` };
    }
    case "set_caption_text": {
      const id = args.cue_id;
      const text = args.text;
      if (typeof id !== "string") return { ok: false, message: "cue_id must be a string." };
      if (typeof text !== "string") return { ok: false, message: "text must be a string." };
      const trimmed = text.trim();
      if (!trimmed) return { ok: false, message: "Caption text cannot be empty; use delete_caption" };
      const cue = p.cues.find((c) => c.id === id);
      if (!cue) return { ok: false, message: `No caption with id ${id}.` };
      cue.text = trimmed;
      if (cue.words) delete cue.words;
      return { ok: true, message: "Updated the caption text.", label: "Edited a caption" };
    }
    case "delete_caption": {
      const id = args.cue_id;
      if (typeof id !== "string") return { ok: false, message: "cue_id must be a string." };
      const before = p.cues.length;
      p.cues = p.cues.filter((c) => c.id !== id);
      if (p.cues.length === before) return { ok: false, message: `No caption with id ${id}.` };
      return { ok: true, message: "Deleted the caption.", label: "Deleted a caption" };
    }
    default:
      return { ok: false, message: `Unknown tool: ${name}` };
  }
}

