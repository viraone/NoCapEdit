import type { VideoProject } from "@/lib/models/project";
import { layoutClips, projectDuration } from "@/lib/models/timeline";

/** Formats a time in seconds as "m:ss.s" with one decimal. */
export function formatTime(t: number): string {
  if (!Number.isFinite(t) || t < 0) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** Plain-text description of a project for the chat model. */
export function describeProject(p: VideoProject, opts?: { playhead?: number; maxTranscriptChars?: number }): string {
  const total = projectDuration(p.clips);
  const maxChars = opts?.maxTranscriptChars ?? 12000;
  let out = `Reel length: ${formatTime(total)} (${total.toFixed(1)} s).`;
  if (opts?.playhead !== undefined) out += ` Playhead: ${formatTime(opts.playhead)}.`;
  out += `\nClips in order (times are reel time):`;
  const layouts = layoutClips(p.clips);
  if (!layouts.length) {
    out += `\nNo clips yet.`;
  } else {
    layouts.forEach((l, i) => {
      const c = l.clip;
      out += `\n${i + 1}. id=${c.id} "${c.name}" reel ${formatTime(l.start)}-${formatTime(l.end)}, source ${formatTime(c.inPoint)}-${formatTime(c.outPoint)}, speed ${c.speed}x, ${c.hasAudio ? "has audio" : "no audio"}`;
    });
  }
  if (!p.cues.length) {
    out += `\nTranscript: none yet. Nothing is known about what is said. Call transcribe to get one.`;
  } else {
    out += `\nTranscript (${p.cues.length} captions, reel time):`;
    let len = 0;
    let cut = false;
    for (const cue of p.cues) {
      const line = `\n[${cue.id}] ${formatTime(cue.start)}-${formatTime(cue.end)} ${cue.text}`;
      if (len + line.length > maxChars) {
        cut = true;
        break;
      }
      out += line;
      len += line.length;
    }
    if (cut) {
      const last = p.cues[p.cues.length - 1];
      out += `\n(transcript cut off here to save space; it continues to ${formatTime(last.end)})`;
    }
  }
  out += `\nOther: ${p.overlays.length} text/overlay items, ${p.voiceovers.length} voiceovers, music ${p.music ? "yes" : "no"}.`;
  return out;
}

