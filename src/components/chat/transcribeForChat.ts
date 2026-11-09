import { useEditor } from "@/store/editorStore";
import { applyGeneratedCaptions, generateCaptions, hasSpeechTrack, type CaptionJobProgress } from "@/lib/speech/generateCaptions";
import { DEFAULT_WHISPER_MODEL } from "@/lib/speech/transcriber";
import { CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { getPreset } from "@/lib/captions/presets";
import type { ToolResult } from "@/lib/chat/toolTypes";

/**
 * Makes captions for the whole reel on this device with the same defaults Make reels uses (default Whisper model,
 * English unless the project knows better) and puts them on the project. Undo reverts it in one step.
 */
export async function transcribeProject(signal: AbortSignal, onProgress: (p: CaptionJobProgress) => void): Promise<ToolResult> {
  const current = useEditor.getState().project;
  if (!current) return { ok: false, message: "No project is open." };
  if (!current.clips.length) return { ok: false, message: "The reel has no clips to transcribe." };
  if (!hasSpeechTrack(current.clips)) return { ok: false, message: "None of the clips has an audio track, so there is nothing to transcribe." };
  const cuesAtStart = current.cues;
  const saved = current.captions.sourceLanguage;
  const language = saved && saved !== "auto" ? saved : "en";
  try {
    const g = await generateCaptions({
      clips: current.clips,
      model: DEFAULT_WHISPER_MODEL,
      language,
      device: "auto",
      diarize: false,
      maxSpeakers: 3,
      rules: { ...CAPTION_RULES, maxWords: getPreset(current.subtitleStyle.presetId).wordsPerCue ?? CAPTION_RULES.maxWords },
      signal,
      onProgress,
    });
    // The user may have moved on to another project while it ran.
    if (useEditor.getState().project?.id !== current.id) return { ok: false, message: "The project was closed while transcribing." };
    if (!g) return { ok: false, message: "No speech was found in the video." };
    useEditor.getState().update((p) => void applyGeneratedCaptions(p, cuesAtStart, g, language, false, current.clips));
    return { ok: true, message: `Transcribed ${g.wordCount} words into ${g.cues.length} captions. The transcript is now in the project description.`, label: `Transcribed ${g.cues.length} captions` };
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}
