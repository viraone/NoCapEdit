"use client";
import { useRef, useState } from "react";
import { Upload, Trash2, Music, Mic2, Volume2, Square, Play } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useSliderTx } from "./shared";
import { importAudio } from "@/lib/media/import";
import type { MusicTrack, Voiceover } from "@/lib/models/project";
import { putAsset } from "@/lib/storage/db";
import { synthesizeSpeech, previewWithBrowserVoice, TTS_VOICES } from "@/lib/speech/tts";
import { resetMlWorker } from "@/lib/speech/mlClient";
import { uid } from "@/lib/utils/id";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { FileDrop } from "@/components/ui/FileDrop";
import { Button } from "@/components/ui/Button";
import { Slider } from "@/components/ui/Slider";
import { Toggle } from "@/components/ui/Toggle";
import { Field, textareaClass } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { NumberInput } from "@/components/ui/NumberInput";

export function MusicPanel() {
  const project = useProject();
  const { update, registerAsset } = useEditor.getState();
  const tx = useSliderTx();
  const [error, setError] = useState<string | null>(null);
  const music = project.music;
  const selection = useEditor((s) => s.selection);
  const [voText, setVoText] = useState("");
  const [voice, setVoice] = useState(TTS_VOICES[0].id);
  const [voJob, setVoJob] = useState<{ message: string; progress: number | null } | null>(null);
  const [voError, setVoError] = useState<string | null>(null);
  const voAbort = useRef<AbortController | null>(null);

  const generateVoiceover = async () => {
    const text = voText.trim();
    if (!text) return;
    setVoError(null);
    const controller = new AbortController();
    voAbort.current = controller;
    setVoJob({ message: "Starting", progress: null });
    try {
      const { blob, duration } = await synthesizeSpeech(text, voice, (p) => setVoJob({ message: p.message, progress: p.progress }), controller.signal);
      const id = uid("asset");
      await putAsset({ id, projectId: project.id, name: `Voice-over ${text.slice(0, 24)}.wav`, type: "audio/wav", size: blob.size, blob, createdAt: Date.now() });
      registerAsset(id, blob);
      const start = useEditor.getState().currentTime;
      const vo: Voiceover = { id: uid("vo"), assetId: id, name: text.slice(0, 40), text, start, duration, volume: 1, language: TTS_VOICES.find((v) => v.id === voice)?.lang };
      update((p) => void p.voiceovers.push(vo));
      setVoText("");
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setVoError(e instanceof Error ? e.message : String(e));
    } finally {
      voAbort.current = null;
      setVoJob(null);
    }
  };
  const editVo = (id: string, fn: (v: Voiceover) => void, history = true) =>
    update(
      (p) => {
        const v = p.voiceovers.find((v) => v.id === id);
        if (v) fn(v);
      },
      { history },
    );

  const onFiles = async (files: File[]) => {
    setError(null);
    try {
      const { assetId, duration, name, blob } = await importAudio(files[0], project.id);
      registerAsset(assetId, blob);
      update((p) => void (p.music = { assetId, name, duration, volume: 0.35, fadeIn: 1, fadeOut: 2, startOffset: 0, loop: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const edit = (fn: (m: MusicTrack) => void, history = true) =>
    update(
      (p) => {
        if (p.music) fn(p.music);
      },
      { history },
    );

  return (
    <>
      <PanelHeader title="Music" description="Background track mixed under the clip audio." />
      <PanelSection>
        <FileDrop accept="audio/*,video/mp4,video/webm" onFiles={onFiles} className="flex flex-col items-center gap-1.5">
          <Upload size={18} className="text-neutral-500" />
          <span className="text-sm">{music ? "Replace music" : "Add a music file"}</span>
          <span className="text-[11px] text-neutral-500">MP3, WAV, M4A, OGG</span>
        </FileDrop>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </PanelSection>
      <PanelSection title="Voice-over (offline TTS)">
        <textarea className={textareaClass} rows={3} placeholder="Type the narration to synthesise…" value={voText} onChange={(e) => setVoText(e.target.value)} disabled={!!voJob} />
        <Field label="Voice / language" hint="MMS-TTS runs on this device via Transformers.js; the first use downloads the voice (~40 MB).">
          <Select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!!voJob}>
            {TTS_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </Select>
        </Field>
        {!voJob ? (
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Button variant="primary" size="sm" onClick={generateVoiceover} disabled={!voText.trim() || !project.clips.length}>
              <Mic2 size={13} /> Generate at playhead
            </Button>
            <Button variant="outline" size="sm" onClick={() => previewWithBrowserVoice(voText, TTS_VOICES.find((v) => v.id === voice)?.lang ?? "en")} disabled={!voText.trim()} title="Quick preview with the browser voice (not saved)">
              <Volume2 size={13} />
            </Button>
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-neutral-800 bg-neutral-900/60 p-2.5">
            <ProgressBar value={voJob.progress} />
            <p className="text-[11px] text-neutral-300">{voJob.message}</p>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                voAbort.current?.abort();
                resetMlWorker();
              }}
            >
              <Square size={11} /> Cancel
            </Button>
          </div>
        )}
        {voError && <p className="text-[11px] text-red-400">{voError}</p>}
        {project.voiceovers.length > 0 && (
          <ul className="space-y-1.5">
            {project.voiceovers.map((vo) => (
              <li key={vo.id} className={cx("rounded-md border border-neutral-800 p-2", selection?.id === vo.id && "border-brand-500/60")}>
                <div className="flex items-center gap-1.5">
                  <button type="button" className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-white" onClick={() => useEditor.getState().seek(vo.start)} title="Jump to voice-over">
                    <Play size={11} />
                  </button>
                  <span className="min-w-0 flex-1 truncate text-sm">{vo.name}</span>
                  <span className="text-[10px] tabular-nums text-neutral-500">{formatTime(vo.duration)}</span>
                  <Button variant="ghost" size="iconSm" className="text-red-300" onClick={() => update((p) => void (p.voiceovers = p.voiceovers.filter((v) => v.id !== vo.id)))} title="Delete">
                    <Trash2 size={12} />
                  </Button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <Field label="Start" right={<button type="button" className="text-brand-300 hover:underline" onClick={() => editVo(vo.id, (v) => void (v.start = useEditor.getState().currentTime))}>playhead</button>}>
                    <NumberInput value={vo.start} min={0} suffix="s" onCommit={(v) => editVo(vo.id, (x) => void (x.start = v))} />
                  </Field>
                  <Slider label="Volume" value={vo.volume} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => editVo(vo.id, (x) => void (x.volume = v), false)} {...tx} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>
      {!music ? (
        <PanelSection>
          <EmptyState icon={<Music size={20} />} title="No music" description="Add a royalty-free track from your device." />
        </PanelSection>
      ) : (
        <>
          <PanelSection title="Track" right={<Button variant="ghost" size="iconSm" className="text-red-300" onClick={() => update((p) => void (p.music = null))} title="Remove"><Trash2 size={13} /></Button>}>
            <p className="truncate text-sm">{music.name}</p>
            <p className="text-[11px] text-neutral-500">{formatTime(music.duration)}</p>
          </PanelSection>
          <PanelSection title="Mix">
            <Slider label="Volume" value={music.volume} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((m) => void (m.volume = v), false)} {...tx} />
            <Slider label="Fade in" value={music.fadeIn} min={0} max={10} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => edit((m) => void (m.fadeIn = v), false)} {...tx} />
            <Slider label="Fade out" value={music.fadeOut} min={0} max={10} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => edit((m) => void (m.fadeOut = v), false)} {...tx} />
            <Slider label="Start offset (in track)" value={music.startOffset} min={0} max={Math.max(0, music.duration - 1)} step={0.1} format={(v) => formatTime(v)} onChange={(v) => edit((m) => void (m.startOffset = v), false)} {...tx} />
            <Toggle checked={music.loop} onChange={(v) => edit((m) => void (m.loop = v))} label="Loop to fill the reel" />
          </PanelSection>
        </>
      )}
    </>
  );
}
