"use client";
import { useEffect, useRef, useState } from "react";
import { Upload, Trash2, Music, Mic2, Volume2, Square, Play, Scissors, RotateCcw } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject, useSliderTx } from "./shared";
import { importAudio } from "@/lib/media/import";
import type { MusicTrack, Voiceover } from "@/lib/models/project";
import { putAsset } from "@/lib/storage/db";
import { synthesizeSpeech, previewWithBrowserVoice, TTS_VOICES } from "@/lib/speech/tts";
import { SFX_LIBRARY, ensureSfxAsset, makeSfxClip, previewSfx, sfxOnCaptions } from "@/lib/audio/sfx";
import { Tile, TileGrid } from "@/components/ui/Tile";
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
import { MusicSearch } from "./MusicSearch";
import { SongPicker } from "./SongPicker";
import { creditLine, licenseLabel } from "@/lib/stock/openverse";
import { projectDuration } from "@/lib/models/timeline";
import { useIsStill, useStillLength } from "./useStillLength";
import { MIN_MUSIC_SECONDS, cutMusicAfter, cutMusicBefore, musicIsCut, musicLayout, musicLoops, musicMaxSpan, musicPieces, musicSpan, musicStart, setMusicSpan, setMusicStart, splitMusicAt } from "@/lib/models/musicTrim";

export function MusicPanel() {
  const project = useProject();
  const { update, registerAsset } = useEditor.getState();
  const tx = useSliderTx();
  const [error, setError] = useState<string | null>(null);
  const music = project.music;
  // A song longer than a picture-only video: offer to hold the last picture for the whole song.
  const videoLen = projectDuration(project.clips);
  const songLen = music ? musicSpan(music) : 0;
  const currentTime = useEditor((s) => s.currentTime);
  const lastClip = project.clips[project.clips.length - 1];
  const lastStill = useIsStill(lastClip);
  const stillLen = useStillLength();
  const selection = useEditor((s) => s.selection);
  const voListRef = useRef<HTMLUListElement>(null);
  // A voice-over picked on the timeline scrolls its row into view.
  useEffect(() => {
    if (selection?.kind !== "voiceover") return;
    voListRef.current?.querySelector<HTMLElement>(`[data-voiceover="${selection.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);
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
  const [sfxId, setSfxId] = useState(SFX_LIBRARY[0].id);
  const [sfxVolume, setSfxVolume] = useState(0.6);
  const [sfxError, setSfxError] = useState<string | null>(null);
  const sfx = SFX_LIBRARY.find((s) => s.id === sfxId) ?? SFX_LIBRARY[0];
  const sfxCount = project.voiceovers.filter((v) => v.kind === "sfx").length;
  const addSfxAt = async (mode: "playhead" | "captions") => {
    setSfxError(null);
    try {
      const { assetId, blob, created } = await ensureSfxAsset(project.id, sfx);
      if (created || !useEditor.getState().assetUrls[assetId]) registerAsset(assetId, blob);
      let n = 0;
      update((p) => {
        if (mode === "playhead") {
          p.voiceovers.push(makeSfxClip(sfx, assetId, useEditor.getState().currentTime, sfxVolume));
          n = 1;
        } else n = sfxOnCaptions(p, sfx, assetId, sfxVolume);
      });
      useEditor.getState().setNotice(mode === "playhead" ? `Added ${sfx.name} at the playhead.` : `Added ${sfx.name} to ${n} caption${n === 1 ? "" : "s"}.`);
    } catch (e) {
      setSfxError(e instanceof Error ? e.message : String(e));
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
  const cut = !!music && musicIsCut(music);
  const trimmed = !!music && (music.startOffset > 0 || (music.endTrim ?? 0) > 0 || cut);
  /** Whether a cut at the playhead would land at least a moment away from the edges and from any cut already there. */
  const canSplit = (() => {
    if (!music) return false;
    return splitMusicAt(structuredClone(music), currentTime);
  })();
  /** The playhead is inside the part of the song that plays, with enough left on both sides. */
  const canStartHere = !!music && currentTime > 0.05 && songLen - currentTime >= MIN_MUSIC_SECONDS;
  const canEndHere = !!music && currentTime >= MIN_MUSIC_SECONDS && songLen - currentTime > 0.05;
  const edit = (fn: (m: MusicTrack) => void, history = true) =>
    update(
      (p) => {
        if (p.music) fn(p.music);
      },
      { history },
    );

  return (
    <>
      <PanelHeader
        title="Music"
        body={
          <>
            <ol className="rf-read rf-steps" data-music-steps>
              <li>
                <span>
                  <b>Add</b> a track, or find free music
                </span>
              </li>
              <li>
                <span>
                  <b>Mix</b> it under your voice
                </span>
              </li>
              <li>
                <span>
                  <b>Drop in</b> effects or a voice-over
                </span>
              </li>
            </ol>
            <p className="rf-read-note mt-2.5">
              Music plays <b>under the clip audio</b>.
            </p>
          </>
        }
      />
      <PanelSection>
        <FileDrop accept="audio/*,video/mp4,video/webm" onFiles={onFiles} className="flex flex-col items-center gap-1.5">
          <Upload size={18} className="text-label-2" />
          <span className="text-[13px] font-semibold">{music ? "Replace music" : "Add a music file"}</span>
          <span className="text-[12px] text-white/70">MP3, WAV, M4A, OGG</span>
        </FileDrop>
        {error && <p className="rf-read-note rf-error">{error}</p>}
      </PanelSection>
      <PanelSection title="Find free music">
        <MusicSearch />
      </PanelSection>
      <PanelSection title="Sound effects">
        <TileGrid cols={4}>
          {SFX_LIBRARY.map((s) => (
            <Tile
              key={s.id}
              icon={<Volume2 size={15} />}
              label={s.name}
              active={sfxId === s.id}
              onClick={() => {
                setSfxId(s.id);
                previewSfx(s);
              }}
              title="Click to preview"
            />
          ))}
        </TileGrid>
        <Slider label="Effect volume" value={sfxVolume} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={setSfxVolume} />
        <div className="grid grid-cols-1 gap-2">
          <Button variant="secondary" size="sm" onClick={() => addSfxAt("playhead")} disabled={!project.clips.length}>
            Add at playhead
          </Button>
          <Button variant="secondary" size="sm" onClick={() => addSfxAt("captions")} disabled={!project.cues.length} title="One effect at the start of every caption">
            Add on every caption
          </Button>
        </div>
        {sfxError && <p className="rf-read-note rf-error">{sfxError}</p>}
        {sfxCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="rf-read-note">
              {sfxCount} effect{sfxCount === 1 ? "" : "s"} on the timeline
            </span>
            <Button variant="ghost" size="xs" className="text-sys-red" onClick={() => update((p) => void (p.voiceovers = p.voiceovers.filter((v) => v.kind !== "sfx")))}>
              <Trash2 size={11} /> Remove all
            </Button>
          </div>
        )}
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
          <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
            <ProgressBar value={voJob.progress} />
            <p className="rf-read-note">{voJob.message}</p>
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
        {voError && <p className="rf-read-note rf-error">{voError}</p>}
        {project.voiceovers.some((v) => v.kind !== "sfx") && (
          <ul ref={voListRef} className="space-y-1.5">
            {project.voiceovers.filter((v) => v.kind !== "sfx").map((vo) => (
              <li
                key={vo.id}
                data-voiceover={vo.id}
                className={cx("rounded-md border border-sys-gray4 p-2", selection?.kind === "voiceover" && selection.id === vo.id && "border-sys-blue")}
                onClick={() => useEditor.getState().select({ kind: "voiceover", id: vo.id })}
              >
                <div className="flex items-center gap-1.5">
                  <button type="button" className="rounded p-0.5 text-label-2 hover:bg-sys-gray4 hover:text-white" onClick={() => useEditor.getState().seek(vo.start)} title="Jump to voice-over">
                    <Play size={11} />
                  </button>
                  <span className="rf-read-face min-w-0 flex-1 truncate text-[14px] text-white">{vo.name}</span>
                  <span className="text-[12px] tabular-nums text-white/70">{formatTime(vo.duration)}</span>
                  <Button variant="ghost" size="iconSm" className="text-sys-red" onClick={() => update((p) => void (p.voiceovers = p.voiceovers.filter((v) => v.id !== vo.id)))} title="Delete">
                    <Trash2 size={12} />
                  </Button>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  <Field label="Start" right={<button type="button" className="text-sys-blue hover:underline" onClick={() => editVo(vo.id, (v) => void (v.start = useEditor.getState().currentTime))}>playhead</button>}>
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
          <EmptyState icon={<Music size={20} />} title="No music" description="Add a file above, or find free music." />
        </PanelSection>
      ) : (
        <>
          <PanelSection title="Track" right={<Button variant="ghost" size="iconSm" className="text-sys-red" onClick={() => update((p) => void (p.music = null))} title="Remove"><Trash2 size={13} /></Button>}>
            <p className="rf-read-face truncate text-[15px] font-semibold text-white">{music.name}</p>
            {music.credit && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-sys-gray4 bg-sys-gray5 px-2 py-1.5 text-[12px] text-white/70">
                <span className="min-w-0 truncate" title={creditLine(music.credit)}>
                  {licenseLabel(music.credit.license)} · {music.credit.artist}
                </span>
                <Button variant="ghost" size="xs" onClick={() => navigator.clipboard?.writeText(creditLine(music.credit!)).then(() => useEditor.getState().setNotice("Copied the music credit."))} title="Copy the attribution line for your caption">
                  Copy credit
                </Button>
              </div>
            )}
            <p className="text-[12px] tabular-nums text-white/70">{formatTime(music.duration)}</p>
          </PanelSection>
          {lastStill && songLen > videoLen + 0.5 && (
            <PanelSection title="Song is longer" >
              <p className="rf-read-note" data-song-longer>
                The song runs <b>{formatTime(songLen - videoLen)}</b> past your video, and the export stops where the video ends. The last clip is a picture, so it can simply stay on screen longer.
              </p>
              <Button variant="primary" size="md" className="w-full" disabled={stillLen.busy} onClick={() => void stillLen.run(lastClip.id, (lastClip.outPoint - lastClip.inPoint) / lastClip.speed + (songLen - videoLen))} data-stretch-picture>
                Show the picture for the whole song
              </Button>
              {stillLen.busy && (
                <div className="space-y-1.5">
                  <ProgressBar value={null} />
                  <p className="rf-read-note">{stillLen.status}</p>
                </div>
              )}
              {stillLen.error && <p className="rf-read-note rf-error whitespace-pre-wrap">{stillLen.error}</p>}
            </PanelSection>
          )}
          <PanelSection title="Mix">
            <Slider label="Volume" value={music.volume} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => edit((m) => void (m.volume = v), false)} {...tx} />
            <Slider label="Fade in" value={music.fadeIn} min={0} max={10} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => edit((m) => void (m.fadeIn = v), false)} {...tx} />
            <Slider label="Fade out" value={music.fadeOut} min={0} max={10} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => edit((m) => void (m.fadeOut = v), false)} {...tx} />
          </PanelSection>
          <PanelSection title="Trim" right={trimmed ? <Button variant="ghost" size="xs" onClick={() => edit((m) => { m.startOffset = 0; m.endTrim = 0; delete m.pieces; })} title="Play the whole song again" data-music-reset><RotateCcw size={12} /> Reset</Button> : undefined}>
            <p className="rf-read-note">
              Drag either end of the green music block on the timeline to trim it. Click the block, then click it again to cut it there. Or cut at the playhead. Playing <b>{formatTime(songLen)}</b> of {formatTime(music.duration)}
              {cut && <> in <b>{musicLayout(music).length} pieces</b></>}.
            </p>
            <div className="grid grid-cols-3 gap-2">
              <Button variant="secondary" size="sm" disabled={!canStartHere} onClick={() => edit((m) => void cutMusicBefore(m, currentTime))} title="Cut away the song before the playhead" data-music-start-here>
                <Scissors size={13} /> Start here
              </Button>
              <Button variant="secondary" size="sm" disabled={!canSplit} onClick={() => edit((m) => void splitMusicAt(m, currentTime))} title="Cut the song in two at the playhead. Then remove either piece from the timeline." data-music-split-here>
                <Scissors size={13} /> Split
              </Button>
              <Button variant="secondary" size="sm" disabled={!canEndHere} onClick={() => edit((m) => void cutMusicAfter(m, currentTime))} title="Cut away the song after the playhead" data-music-end-here>
                <Scissors size={13} /> End here
              </Button>
            </div>
            {!cut && <SongPicker music={music} videoLen={videoLen} />}
            <Slider label="Start in the song" value={musicStart(music)} min={0} max={Math.max(0, musicPieces(music)[0].to - MIN_MUSIC_SECONDS)} step={0.1} format={(v) => formatTime(v)} onChange={(v) => edit((m) => setMusicStart(m, v), false)} {...tx} />
            <Slider label="Length played" value={songLen} min={Math.min(MIN_MUSIC_SECONDS, musicMaxSpan(music))} max={musicMaxSpan(music)} step={0.1} format={(v) => formatTime(v)} onChange={(v) => edit((m) => setMusicSpan(m, v), false)} {...tx} />
            <Toggle checked={musicLoops(music)} disabled={(music.endTrim ?? 0) > 0 || cut} onChange={(v) => edit((m) => void (m.loop = v))} label="Loop to fill the reel" description={(music.endTrim ?? 0) > 0 || cut ? "Off while the music is cut or its end is trimmed. Reset the trim to loop." : undefined} />
          </PanelSection>
        </>
      )}
    </>
  );
}
