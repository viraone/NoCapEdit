"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Mic, Square, Trash2, Merge, Scissors, Anchor, Plus, Languages, FileUp, Play } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { engine } from "@/lib/playback/engine";
import { getAsset } from "@/lib/storage/db";
import { getSpeechAudio } from "@/lib/speech/audioCache";
import { layoutClips } from "@/lib/models/timeline";
import type { CaptionCue, WordTiming } from "@/lib/models/project";
import { buildCues, mergeCues, splitCue, sortCues } from "@/lib/speech/captionBuilder";
import { WHISPER_MODELS, DEFAULT_WHISPER_MODEL, sliceSamples, wordsToProjectTime, type DevicePreference } from "@/lib/speech/transcriber";
import { transcribeWithSpeakers, buildSpeakerCues, type SpeakerSegment } from "@/lib/transcriptionEngine";
import { toProjectTime } from "@/lib/models/timeline";
import { resetMlWorker } from "@/lib/speech/mlClient";
import { translateTexts, canTranslate } from "@/lib/speech/translator";
import { isWebSpeechAvailable, startLiveDictation, type LiveDictationController } from "@/lib/speech/webSpeech";
import { LANGUAGES, WHISPER_LANGUAGE_OPTIONS } from "@/lib/speech/languages";
import { parseSrt } from "@/lib/captions/srt";
import { uid } from "@/lib/utils/id";
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

function CueText({ value, onCommit, placeholder, className }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText(value);
  }
  return (
    <input
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
  const activeCueId = useEditor((s) => {
    const t = s.currentTime;
    return s.project?.cues.find((c) => t >= c.start && t < c.end)?.id ?? null;
  });
  const { update, select, seek } = useEditor.getState();

  const [model, setModel] = useState(DEFAULT_WHISPER_MODEL);
  const [language, setLanguage] = useState(project.captions.sourceLanguage || "auto");
  const [device, setDevice] = useState<DevicePreference>("auto");
  const [diarize, setDiarize] = useState(false);
  const [maxSpeakers, setMaxSpeakers] = useState(3);
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
    const controller = new AbortController();
    abortRef.current = controller;
    const layouts = layoutClips(project.clips);
    const words: WordTiming[] = [];
    const segments: SpeakerSegment[] = [];
    let speakerOffset = 0;
    let usedDevice = "";
    let diarizationNote = "";
    try {
      for (const [i, layout] of layouts.entries()) {
        const prefix = layouts.length > 1 ? `Clip ${i + 1}/${layouts.length}: ` : "";
        setJob({ kind: "transcribe", message: `${prefix}Decoding audio`, progress: null });
        const asset = await getAsset(layout.clip.assetId);
        if (!asset) continue;
        const audio = await getSpeechAudio(asset.id, asset.blob);
        if (!audio) continue;
        const samples = sliceSamples(audio.samples, layout.clip.inPoint, layout.clip.outPoint, audio.sampleRate);
        if (samples.length < audio.sampleRate * 0.3) continue;
        const result = await transcribeWithSpeakers(samples, {
          model,
          language,
          device,
          diarize,
          maxSpeakers,
          signal: controller.signal,
          onProgress: (p) => setJob({ kind: "transcribe", message: `${prefix}${p.message}`, progress: p.progress, partial: p.partialText }),
        });
        usedDevice = result.device;
        words.push(...wordsToProjectTime(result.words, layout));
        if (result.speakers) {
          for (const s of result.speakers) {
            segments.push({
              start: toProjectTime(layout, layout.clip.inPoint + s.start),
              end: toProjectTime(layout, layout.clip.inPoint + s.end),
              speaker: s.speaker + speakerOffset,
            });
          }
          speakerOffset += result.speakerCount;
        }
        if (result.diarizationError) diarizationNote = ` Speaker detection failed: ${result.diarizationError}`;
      }
      const cues = diarize ? buildSpeakerCues(words, segments.length ? segments : null) : buildCues(words);
      update((p) => {
        p.cues = cues;
        p.captions.sourceLanguage = language;
        if (diarize && segments.length) p.subtitleStyle.speakerColors = true;
      });
      const speakerCount = new Set(cues.map((c) => c.speaker).filter((s) => s !== undefined)).size;
      setNotice(`${cues.length} captions from ${words.length} words (${usedDevice || "on-device"})${speakerCount ? `, ${speakerCount} speaker${speakerCount === 1 ? "" : "s"}` : ""}.${diarizationNote}`);
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
    seek(0);
    engine.play();
    setJob({ kind: "dictate", message: "Listening while the reel plays. Turn the volume up so the microphone can hear it.", progress: null });
    const finish = () => {
      dictationRef.current = null;
      clearInterval(timer);
      engine.pause();
      const cues = buildCues(collected);
      if (cues.length) update((p) => void (p.cues = cues));
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
      setNotice(`Translated with the ${result.engine === "browser" ? "built-in browser translator" : "on-device Marian model"}.`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const importSrt = async (file: File) => {
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
      <PanelHeader title="Subtitles" description="Speech recognition and translation run on this device. Models download once and are cached." />
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
        <p className="text-[11px] text-neutral-500">{WHISPER_MODELS.find((m) => m.id === model)?.note}</p>
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
          <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
            <ProgressBar value={job.progress} />
            <p className="text-[11px] text-neutral-300">{job.message}</p>
            {job.partial && <p className="max-h-16 overflow-hidden text-[11px] leading-snug text-neutral-500">{job.partial}</p>}
            <Button variant="outline" size="sm" onClick={cancel}>
              <Square size={12} /> Cancel
            </Button>
          </div>
        )}
        {error && <p className="text-[11px] text-red-400">{error}</p>}
        {notice && <p className="text-[11px] text-emerald-400">{notice}</p>}
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-200">
            <FileUp size={12} /> Import .srt
            <input type="file" accept=".srt,text/plain" className="hidden" onChange={(e) => e.target.files?.[0] && importSrt(e.target.files[0])} />
          </label>
          <span className="text-neutral-700">·</span>
          <button type="button" className="text-[11px] text-neutral-400 hover:text-neutral-200" onClick={() => update((p) => void (p.cues = []))} disabled={!project.cues.length}>
            Clear all
          </button>
        </div>
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
        {!canTranslate(sourceLang, project.captions.targetLanguage) && <p className="text-[11px] text-neutral-500">No on-device model for this language pair yet.</p>}
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
                  className={cx("rounded-md border px-2 py-1.5", active ? "border-brand-500/60 bg-brand-500/5" : "border-neutral-800", selected && "ring-1 ring-brand-500")}
                  onClick={() => select({ kind: "cue", id: cue.id })}
                >
                  <div className="mb-1 flex items-center gap-1 text-[10px] tabular-nums text-neutral-500">
                    <button type="button" className="rounded p-0.5 hover:bg-neutral-800 hover:text-neutral-200" onClick={(e) => (e.stopPropagation(), seek(cue.start))} title="Jump to cue">
                      <Play size={10} />
                    </button>
                    <NumberInput value={cue.start} min={0} max={cue.end - 0.1} className="h-5 w-16 px-1 text-[10px]" onCommit={(v) => editCue(cue.id, (c) => void (c.start = v))} />
                    <span>→</span>
                    <NumberInput value={cue.end} min={cue.start + 0.1} className="h-5 w-16 px-1 text-[10px]" onCommit={(v) => editCue(cue.id, (c) => void (c.end = v))} />
                    <span className="ml-auto flex items-center">
                      <button type="button" className="rounded p-0.5 hover:bg-neutral-800 hover:text-neutral-200" title="Split in the middle" onClick={(e) => (e.stopPropagation(), splitMiddle(cue.id))}>
                        <Scissors size={11} />
                      </button>
                      <button type="button" className="rounded p-0.5 hover:bg-neutral-800 hover:text-neutral-200 disabled:opacity-30" title="Merge with next" disabled={i === sorted.length - 1} onClick={(e) => (e.stopPropagation(), mergeWithNext(cue.id))}>
                        <Merge size={11} />
                      </button>
                      <button
                        type="button"
                        className={cx("rounded p-0.5 hover:bg-neutral-800 hover:text-neutral-200", cue.anchor && "text-amber-300")}
                        title={cue.anchor ? "Detached: click to follow the global position again" : "Detach: give this cue its own position (or Alt-drag it on the preview)"}
                        onClick={(e) => (e.stopPropagation(), editCue(cue.id, (c) => void (c.anchor = c.anchor ? null : { x: project.subtitleStyle.x, y: project.subtitleStyle.y })))}
                      >
                        <Anchor size={11} />
                      </button>
                      <button type="button" className="rounded p-0.5 text-red-300 hover:bg-neutral-800" title="Delete" onClick={(e) => (e.stopPropagation(), removeCue(cue.id))}>
                        <Trash2 size={11} />
                      </button>
                    </span>
                  </div>
                  <CueText value={cue.text} onCommit={(v) => editCue(cue.id, (c) => void (c.text = v))} />
                  {project.captions.showTranslated && (
                    <CueText className="mt-1 text-neutral-300" value={cue.translatedText ?? ""} placeholder="Translation" onCommit={(v) => editCue(cue.id, (c) => void (c.translatedText = v))} />
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
