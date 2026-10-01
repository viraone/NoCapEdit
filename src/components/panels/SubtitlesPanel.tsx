"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Mic, Square, Trash2, Merge, Scissors, Anchor, Plus, Languages, FileUp, Play } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { engine } from "@/lib/playback/engine";
import type { CaptionCue, WordTiming } from "@/lib/models/project";
import { buildCues, cuesEditedSince, mergeCues, regroupCues, splitCue, sortCues, CAPTION_RULES } from "@/lib/speech/captionBuilder";
import { findHighlights, type Highlight } from "@/lib/edit/highlights";
import { activeModel, findAiHighlights, loadAiSettings, loadHighlightFinder, localAiEnabled, saveAiSettings, saveHighlightFinder, type AiSettings } from "@/lib/edit/aiHighlights";
import { AiModelFields } from "./AiModelFields";
import { keepOnly } from "@/lib/edit/magicCut";
import { getPreset } from "@/lib/captions/presets";
import { Sparkle, Wand } from "lucide-react";
import { listOllamaModels } from "@/lib/edit/aiHighlights";
import { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, type DevicePreference } from "@/lib/speech/transcriber";
import { applyGeneratedCaptions, generateCaptions, hasSpeechTrack } from "@/lib/speech/generateCaptions";
import { buildSpeakerCues } from "@/lib/transcriptionEngine";
import { resetMlWorker } from "@/lib/speech/mlClient";
import { translateTexts, canTranslate } from "@/lib/speech/translator";
import { isWebSpeechAvailable, startLiveDictation, type LiveDictationController } from "@/lib/speech/webSpeech";
import { LANGUAGES, WHISPER_LANGUAGE_OPTIONS } from "@/lib/speech/languages";
import { parseSrt } from "@/lib/captions/srt";
import { uid } from "@/lib/utils/id";
import { formatTime, nowMs } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field, inputClass } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { NumberInput } from "@/components/ui/NumberInput";

interface Job {
  kind: "transcribe" | "translate" | "dictate";
  message: string;
  progress: number | null;
  partial?: string;
}

function CueText({ value, onCommit, placeholder, className, focusNonce }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; focusNonce?: number }) {
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText(value);
  }
  const ref = useRef<HTMLInputElement>(null);
  // A canvas double-click asks for the caret here with the text selected.
  useEffect(() => {
    if (!focusNonce) return;
    ref.current?.focus();
    ref.current?.select();
  }, [focusNonce]);
  return (
    <input
      ref={ref}
      data-content-editor="cue"
      className={cx(inputClass, "h-7 text-[13px]", className)}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export function SubtitlesPanel() {
  const project = useProject();
  const selection = useEditor((s) => s.selection);
  const editRequest = useEditor((s) => s.editRequest);
  const activeCueId = useEditor((s) => {
    const t = s.currentTime;
    return s.project?.cues.find((c) => t >= c.start && t < c.end)?.id ?? null;
  });
  const { update, select, seek, setNotice: pushNotice } = useEditor.getState();

  const [model, setModel] = useState(DEFAULT_WHISPER_MODEL);
  const [language, setLanguage] = useState(project.captions.sourceLanguage || "auto");
  const [device, setDevice] = useState<DevicePreference>("auto");
  const [diarize, setDiarize] = useState(false);
  const [maxSpeakers, setMaxSpeakers] = useState(3);
  const [wordsPerCue, setWordsPerCue] = useState<number>(getPreset(project.subtitleStyle.presetId).wordsPerCue ?? CAPTION_RULES.maxWords);
  const rules = { ...CAPTION_RULES, maxWords: wordsPerCue };
  const [highlightLen, setHighlightLen] = useState(30);
  const [highlights, setHighlights] = useState<Highlight[] | null>(null);
  // Local AI finder (Ollama on this machine); offered on localhost or with reelflow.localAi=1.
  const [aiAvailable] = useState(localAiEnabled);
  // Word statistics by default; picking Local AI is remembered on this machine.
  const [finder, setFinder] = useState<"stats" | "ai">(() => (localAiEnabled() && loadHighlightFinder() === "ai" ? "ai" : "stats"));
  const [aiSettings, setAiSettings] = useState<AiSettings>(loadAiSettings);
  const [aiCount, setAiCount] = useState(5);
  const [aiJob, setAiJob] = useState<{ message: string; started: number } | null>(null);
  const [aiElapsed, setAiElapsed] = useState(0);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiAbortRef = useRef<AbortController | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const dictationRef = useRef<LiveDictationController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selection || selection.kind !== "cue") return;
    listRef.current?.querySelector<HTMLElement>(`[data-cue="${selection.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  useEffect(() => {
    if (!aiJob) return;
    const id = setInterval(() => setAiElapsed(Math.round((nowMs() - aiJob.started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [aiJob]);
  useEffect(() => () => aiAbortRef.current?.abort(), []);

  const cancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    resetMlWorker();
    dictationRef.current?.stop();
    dictationRef.current = null;
    setJob(null);
  };

  const transcribe = async () => {
    if (!project.clips.length) return;
    setError(null);
    setNotice(null);
    if (!hasSpeechTrack(project.clips)) {
      setError(project.cues.length ? "None of the clips has an audio track, so there is nothing to transcribe. Your captions were kept." : "None of the clips has an audio track, so there is nothing to transcribe.");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    // Cues edited or imported while this job runs are kept when it finishes.
    const cuesAtStart = useEditor.getState().project?.cues ?? [];
    try {
      const g = await generateCaptions({ clips: project.clips, model, language, device, diarize, maxSpeakers, rules, signal: controller.signal, onProgress: (p) => setJob({ kind: "transcribe", ...p }) });
      if (!g) {
        // Nothing transcribed: never replace existing captions with an empty list.
        setError(useEditor.getState().project?.cues.length ? "No speech was found; your existing captions were kept." : "No speech was found.");
        return;
      }
      let kept = 0;
      update((p) => void (kept = applyGeneratedCaptions(p, cuesAtStart, g, language, diarize)));
      const keptNote = kept ? ` ${kept} caption${kept === 1 ? "" : "s"} edited or imported while generating ${kept === 1 ? "was" : "were"} kept alongside the new ones (Undo reverts).` : "";
      setNotice(`${g.cues.length} captions from ${g.wordCount} words (${g.device || "on-device"})${g.speakerCount ? `, ${g.speakerCount} speaker${g.speakerCount === 1 ? "" : "s"}` : ""}.${g.diarizationNote}${keptNote}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const dictate = () => {
    if (!project.clips.length) return;
    setError(null);
    setNotice(null);
    const collected: WordTiming[] = [];
    const cuesAtStart = useEditor.getState().project?.cues ?? [];
    seek(0);
    engine.play();
    setJob({ kind: "dictate", message: "Listening while the reel plays. Turn the volume up so the microphone can hear it.", progress: null });
    const finish = () => {
      dictationRef.current = null;
      clearInterval(timer);
      engine.pause();
      const cues = buildCues(collected, rules);
      if (cues.length)
        update((p) => {
          const edited = cuesEditedSince(cuesAtStart, p.cues);
          p.cues = edited.length ? sortCues([...edited, ...cues]) : cues;
        });
      setNotice(cues.length ? `${cues.length} captions from live dictation (timings are approximate).` : "Nothing was recognised.");
      setJob(null);
    };
    const controller = startLiveDictation({
      lang: language === "auto" ? navigator.language : language,
      getTime: () => engine.time,
      onWords: (w) => {
        collected.push(...w);
        setJob({ kind: "dictate", message: `Heard ${collected.length} words…`, progress: engine.duration ? engine.time / engine.duration : null });
      },
      onInterim: (text) => setJob((j) => (j ? { ...j, partial: text } : j)),
      onEnd: (err) => {
        if (err) setError(err);
        finish();
      },
    });
    dictationRef.current = controller;
    const timer = setInterval(() => {
      if (!engine.playing && dictationRef.current) dictationRef.current.stop();
    }, 500);
  };

  const translate = async () => {
    const source = project.captions.sourceLanguage === "auto" ? "en" : project.captions.sourceLanguage;
    const target = project.captions.targetLanguage;
    if (!project.cues.length) return;
    setError(null);
    setNotice(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ kind: "translate", message: "Preparing translator", progress: null });
    try {
      const sorted = sortCues(project.cues);
      const result = await translateTexts(
        sorted.map((c) => c.text),
        { source, target, signal: controller.signal, onProgress: (p) => setJob({ kind: "translate", message: p.message, progress: p.progress }) },
      );
      update((p) => {
        p.cues.forEach((c) => {
          const i = sorted.findIndex((s) => s.id === c.id);
          if (i >= 0) c.translatedText = result.translations[i];
        });
        p.captions.showTranslated = true;
      });
      const ENGINE_NOTICE: Record<typeof result.engine, string> = {
        copy: "Source and target language are the same; captions copied.",
        browser: "Translated with the built-in browser translator.",
        marian: "Translated with the on-device Marian model.",
      };
      setNotice(ENGINE_NOTICE[result.engine]);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const regroup = () => {
    setError(null);
    setNotice(null);
    if (!project.cues.some((c) => c.words?.length)) {
      setError("Re-grouping needs word timings; generate captions first.");
      return;
    }
    const segments = project.cues.filter((c) => c.speaker !== undefined).map((c) => ({ start: c.start, end: c.end, speaker: c.speaker! }));
    // From each cue's current text, so edits and cues without word timings survive.
    update((p) => void (p.cues = regroupCues(p.cues, (w) => (segments.length ? buildSpeakerCues(w, segments, rules) : buildCues(w, rules)))));
    pushNotice(`Re-grouped into ${wordsPerCue}-word captions.`);
  };

  const updateAiSettings = (patch: Partial<AiSettings>) => {
    const next = { ...aiSettings, ...patch };
    setAiSettings(next);
    saveAiSettings(next);
  };
  // Installed Ollama models for the picker (like MyClicky's model menu).
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const refreshModels = async (endpoint = aiSettings.endpoint) => {
    if (aiSettings.provider !== "ollama") return;
    setModelsError(null);
    try {
      setModels(await listOllamaModels(endpoint));
    } catch {
      setModels(null);
      setModelsError("Couldn't list models: is Ollama running?");
    }
  };
  useEffect(() => {
    if (!aiAvailable) return;
    const id = setTimeout(() => void refreshModels(), 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAvailable]);

  const runHighlights = async () => {
    setAiError(null);
    if (finder === "stats") {
      setHighlights(findHighlights(project.cues, highlightLen, 3));
      return;
    }
    setHighlights(null);
    setAiElapsed(0);
    const controller = new AbortController();
    aiAbortRef.current = controller;
    setAiJob({ message: `Sending the transcript to ${activeModel(aiSettings)}`, started: nowMs() });
    try {
      const found = await findAiHighlights(project.cues, {
        settings: aiSettings,
        count: aiCount,
        minSeconds: Math.max(8, Math.round(highlightLen * 0.6)),
        maxSeconds: Math.round(highlightLen * 1.6),
        signal: controller.signal,
        onProgress: (message) => setAiJob((j) => (j ? { ...j, message } : j)),
      });
      setHighlights(found);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      aiAbortRef.current = null;
      setAiJob(null);
    }
  };

  const importSrt = async (file: File) => {
    setError(null);
    setNotice(null);
    const cues = parseSrt(await file.text());
    if (!cues.length) {
      setError("No cues found in that file.");
      return;
    }
    update((p) => void (p.cues = cues));
    setNotice(`Imported ${cues.length} captions.`);
  };

  const editCue = (id: string, fn: (c: CaptionCue) => void) =>
    update((p) => {
      const c = p.cues.find((c) => c.id === id);
      if (c) fn(c);
    });
  const addCue = () => {
    const t = useEditor.getState().currentTime;
    const cue: CaptionCue = { id: uid("cue"), start: t, end: t + 1.5, text: "New caption", anchor: null };
    update((p) => void (p.cues = sortCues([...p.cues, cue])));
    select({ kind: "cue", id: cue.id });
  };
  const removeCue = (id: string) => {
    update((p) => void (p.cues = p.cues.filter((c) => c.id !== id)));
    if (selection?.id === id) select(null);
  };
  const mergeWithNext = (id: string) =>
    update((p) => {
      const sorted = sortCues(p.cues);
      const i = sorted.findIndex((c) => c.id === id);
      if (i < 0 || i >= sorted.length - 1) return;
      const merged = mergeCues(sorted[i], sorted[i + 1]);
      sorted.splice(i, 2, merged);
      p.cues = sorted;
    });
  const splitMiddle = (id: string) =>
    update((p) => {
      const i = p.cues.findIndex((c) => c.id === id);
      if (i < 0) return;
      const tokens = p.cues[i].text.split(/\s+/).filter(Boolean);
      const parts = splitCue(p.cues[i], Math.ceil(tokens.length / 2));
      if (parts) p.cues.splice(i, 1, ...parts);
    });

  const sourceLang = project.captions.sourceLanguage === "auto" ? "en" : project.captions.sourceLanguage;
  const sorted = sortCues(project.cues);
  const busy = !!job;

  return (
    <>
      <PanelHeader
        title="Subtitles"
        body={
          <>
            <ol className="rf-read rf-steps" data-subtitles-steps>
              <li>
                <span>
                  <b>Generate</b> captions from speech
                </span>
              </li>
              <li>
                <span>
                  <b>Translate</b> them if you need to
                </span>
              </li>
              <li>
                <span>
                  <b>Edit</b> any line in the list below
                </span>
              </li>
            </ol>
            <p className="rf-read-note mt-2.5">
              Runs on this device. <b>Models download once</b>, then stay cached.
            </p>
          </>
        }
      />
      <PanelSection title="Auto captions">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Model">
            <Select value={model} onChange={(e) => setModel(e.target.value)} disabled={busy}>
              {WHISPER_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.size}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
              {WHISPER_LANGUAGE_OPTIONS.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Compute">
          <Select value={device} onChange={(e) => setDevice(e.target.value as DevicePreference)} disabled={busy}>
            <option value="auto">Auto (WebGPU when available)</option>
            <option value="webgpu">WebGPU</option>
            <option value="wasm">WASM (CPU)</option>
          </Select>
        </Field>
        <p className="rf-read-note">{WHISPER_MODELS.find((m) => m.id === model)?.note}</p>
        <Field label="Words per caption" hint="Viral styles like Hormozi read best with 1–2 words; Re-group applies it to existing captions.">
          <div className="flex gap-2">
            <Select value={String(wordsPerCue)} onChange={(e) => setWordsPerCue(Number(e.target.value))} disabled={busy}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Button variant="outline" size="md" onClick={regroup} disabled={busy || !project.cues.length} title="Re-group existing captions">
              Re-group
            </Button>
          </div>
        </Field>
        <Toggle checked={diarize} onChange={setDiarize} label="Identify speakers" description="pyannote + WeSpeaker on-device; adds a minute or two" disabled={busy} />
        {diarize && (
          <Field label="Max speakers">
            <Select value={String(maxSpeakers)} onChange={(e) => setMaxSpeakers(Number(e.target.value))} disabled={busy}>
              {[1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {!job ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button variant="primary" onClick={transcribe} disabled={!project.clips.length}>
              <Sparkles size={14} /> Generate captions
            </Button>
            <Button variant="outline" onClick={dictate} disabled={!project.clips.length || !isWebSpeechAvailable()} title="Fallback: Web Speech API listens through the microphone while the reel plays">
              <Mic size={14} />
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
            <ProgressBar value={job.progress} />
            <p className="rf-read-note">{job.message}</p>
            {job.partial && <p className="rf-read-note max-h-16 overflow-hidden">{job.partial}</p>}
            <Button variant="outline" size="sm" onClick={cancel}>
              <Square size={12} /> Cancel
            </Button>
          </div>
        )}
        {error && <p className="rf-read-note rf-error">{error}</p>}
        {notice && <p className="rf-read-note rf-ok">{notice}</p>}
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-label-2 hover:text-white">
            <FileUp size={12} /> Import .srt
            <input type="file" accept=".srt,text/plain" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                // Reset so choosing the same file again fires change.
                e.target.value = "";
                if (f) importSrt(f);
              }} />
          </label>
          <span className="text-sys-gray3">·</span>
          <button type="button" className="text-[11px] text-label-2 hover:text-white" onClick={() => {
              setError(null);
              setNotice(null);
              update((p) => void (p.cues = []));
            }} disabled={!project.cues.length}>
            Clear all
          </button>
        </div>
      </PanelSection>
      <PanelSection title="Highlights">
        {aiAvailable && (
          <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-sys-gray5 p-0.5" role="group" aria-label="Highlight finder">
            {(
              [
                ["ai", "Local AI"],
                ["stats", "Word statistics"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={finder === id}
                disabled={!!aiJob}
                onClick={() => {
                  setFinder(id);
                  saveHighlightFinder(id);
                  setHighlights(null);
                  setAiError(null);
                }}
                className={cx("h-7 rounded-md text-[11px] font-semibold", finder === id ? "bg-sys-gray3 text-white" : "text-label-2 hover:text-white")}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Select value={String(highlightLen)} onChange={(e) => setHighlightLen(Number(e.target.value))} disabled={!!aiJob} aria-label="Clip length">
            <option value="15">15 s</option>
            <option value="30">30 s</option>
            <option value="60">60 s</option>
          </Select>
          {finder === "ai" && (
            <Select value={String(aiCount)} onChange={(e) => setAiCount(Number(e.target.value))} disabled={!!aiJob} aria-label="Number of clips">
              <option value="3">× 3</option>
              <option value="5">× 5</option>
              <option value="8">× 8</option>
              <option value="12">× 12</option>
            </Select>
          )}
          <Button variant="secondary" size="md" onClick={runHighlights} disabled={!project.cues.length || !!aiJob}>
            <Sparkle size={14} /> Find
          </Button>
        </div>
        {finder === "ai" && !aiJob && <AiModelFields settings={aiSettings} onChange={updateAiSettings} models={models} modelsError={modelsError} onRefresh={() => void refreshModels()} />}
        {aiJob && (
          <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
            <ProgressBar value={null} />
            <p className="rf-read-note">
              {aiJob.message} · <span className="rf-mono">{aiElapsed} s</span>
            </p>
            <Button variant="outline" size="sm" onClick={() => aiAbortRef.current?.abort()}>
              <Square size={12} /> Cancel
            </Button>
          </div>
        )}
        {aiError && <p className="rf-read-note rf-error whitespace-pre-wrap">{aiError}</p>}
        {highlights && highlights.length === 0 && (
          <p className="rf-read-note">{finder === "ai" ? "The model found no clips that fit this length; try a longer clip length." : "Nothing stood out; try a longer clip length."}</p>
        )}
        {highlights?.map((h, i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2">
            <div className="flex items-center justify-between text-[12px] text-white/70">
              <span className="tabular-nums">
                {formatTime(h.start)} – {formatTime(h.end)} · {Math.round(h.end - h.start)} s
              </span>
              {h.title ? <span className="tabular-nums font-semibold text-sys-yellow">{h.score}/10</span> : <span>{h.reasons.slice(0, 2).join(" · ")}</span>}
            </div>
            {h.title && (
              <p className="rf-read">
                <b>{h.title}</b>
              </p>
            )}
            {/* The spoken words, in the reading face like the caption chips. */}
            <p className="rf-read-note line-clamp-3">&ldquo;{h.text}&rdquo;</p>
            {h.title && h.reasons[0] && <p className="rf-read-note line-clamp-2">{h.reasons[0]}</p>}
            <div className="flex gap-1.5">
              <Button variant="ghost" size="xs" onClick={() => seek(h.start)}>
                <Play size={11} /> Jump
              </Button>
              <Button
                variant="secondary"
                size="xs"
                onClick={() => {
                  update((p) => void keepOnly(p, h.start, h.end));
                  setHighlights(null);
                  pushNotice(`Trimmed the reel to ${Math.round(h.end - h.start)} s.`);
                }}
              >
                <Wand size={11} /> Keep only this
              </Button>
            </div>
          </div>
        ))}
      </PanelSection>
      <PanelSection title="Translate">
        <div className="grid grid-cols-2 gap-2">
          <Field label="From">
            <Select value={sourceLang} onChange={(e) => update((p) => void (p.captions.sourceLanguage = e.target.value))} disabled={busy}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="To">
            <Select value={project.captions.targetLanguage} onChange={(e) => update((p) => void (p.captions.targetLanguage = e.target.value))} disabled={busy}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Button variant="secondary" className="w-full" onClick={translate} disabled={busy || !project.cues.length || !canTranslate(sourceLang, project.captions.targetLanguage)}>
          <Languages size={14} /> Translate captions
        </Button>
        {!canTranslate(sourceLang, project.captions.targetLanguage) && <p className="rf-read-note">No on-device model for this language pair yet.</p>}
        <Toggle checked={project.captions.showTranslated} onChange={(v) => update((p) => void (p.captions.showTranslated = v))} label="Show translated captions" description="Applies to the preview and the export" />
      </PanelSection>
      <PanelSection
        title={`Cues (${project.cues.length})`}
        right={
          <Button variant="ghost" size="xs" onClick={addCue} disabled={!project.clips.length}>
            <Plus size={12} /> Add at playhead
          </Button>
        }
      >
        {sorted.length === 0 ? (
          <EmptyState title="No captions yet" description="Generate them from speech, import an .srt file or add cues by hand." />
        ) : (
          <div ref={listRef} className="space-y-1.5">
            {sorted.map((cue, i) => {
              const selected = selection?.kind === "cue" && selection.id === cue.id;
              const active = activeCueId === cue.id;
              return (
                <div
                  key={cue.id}
                  data-cue={cue.id}
                  className={cx("rounded-md border px-2 py-1.5", active ? "border-sys-blue bg-sys-blue/10" : "border-sys-gray4", selected && "ring-1 ring-sys-blue")}
                  onClick={() => select({ kind: "cue", id: cue.id })}
                >
                  <div className="mb-1 flex items-center gap-1 text-[10px] tabular-nums text-label-2">
                    <button type="button" className="rounded p-0.5 hover:bg-sys-gray4 hover:text-white" onClick={(e) => (e.stopPropagation(), seek(cue.start))} title="Jump to cue">
                      <Play size={10} />
                    </button>
                    <NumberInput value={cue.start} min={0} max={cue.end - 0.1} className="h-5 w-16 px-1 text-[10px]" onCommit={(v) => editCue(cue.id, (c) => void (c.start = v))} />
                    <span>→</span>
                    <NumberInput value={cue.end} min={cue.start + 0.1} className="h-5 w-16 px-1 text-[10px]" onCommit={(v) => editCue(cue.id, (c) => void (c.end = v))} />
                    <span className="ml-auto flex items-center">
                      <button type="button" className="rounded p-0.5 hover:bg-sys-gray4 hover:text-white" title="Split in the middle" onClick={(e) => (e.stopPropagation(), splitMiddle(cue.id))}>
                        <Scissors size={11} />
                      </button>
                      <button type="button" className="rounded p-0.5 hover:bg-sys-gray4 hover:text-white disabled:opacity-30" title="Merge with next" disabled={i === sorted.length - 1} onClick={(e) => (e.stopPropagation(), mergeWithNext(cue.id))}>
                        <Merge size={11} />
                      </button>
                      <button
                        type="button"
                        className={cx("rounded p-0.5 hover:bg-sys-gray4 hover:text-white", cue.anchor && "text-sys-yellow")}
                        title={cue.anchor ? "Detached: click to follow the global position again" : "Detach: give this cue its own position (or Alt-drag it on the preview)"}
                        onClick={(e) => (e.stopPropagation(), editCue(cue.id, (c) => void (c.anchor = c.anchor ? null : { x: project.subtitleStyle.x, y: project.subtitleStyle.y })))}
                      >
                        <Anchor size={11} />
                      </button>
                      <button type="button" className="rounded p-0.5 text-sys-red hover:bg-sys-gray4" title="Delete" onClick={(e) => (e.stopPropagation(), removeCue(cue.id))}>
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </div>
                  <CueText value={cue.text} onCommit={(v) => editCue(cue.id, (c) => void (c.text = v))} focusNonce={editRequest?.kind === "cue" && editRequest.id === cue.id ? editRequest.nonce : undefined} />
                  {project.captions.showTranslated && (
                    <CueText className="mt-1 text-label-2" value={cue.translatedText ?? ""} placeholder="Translation" onCommit={(v) => editCue(cue.id, (c) => void (c.translatedText = v))} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </PanelSection>
    </>
  );
}
