"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Clapperboard, Copy, Download, FileText, Loader2, RotateCcw, Scissors, X } from "lucide-react";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { createProject } from "@/lib/models/project";
import { deleteProject, requestPersistentStorage, saveProject } from "@/lib/storage/db";
import { AiModelFields } from "@/components/panels/AiModelFields";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { writeDocumentaryScript, aiMissing } from "@/lib/documentary/ai";
import { DocumentaryChat } from "@/components/start/DocumentaryChat";
import { filmSupported, renderFilm, type FilmHeight } from "@/lib/documentary/film";
import type { DocScript } from "@/lib/documentary/script";
import type { FilmTimeline } from "@/lib/documentary/timeline";
import { cuesToSrt, cuesToText, transcriptFileName, type Transcript } from "@/lib/documentary/transcript";
import { loadAiSettings, saveAiSettings, activeModel, type AiSettings } from "@/lib/edit/aiHighlights";
import { isKokoroVoice, KOKORO_VOICES } from "@/lib/speech/kokoro";
import { TTS_VOICES } from "@/lib/speech/tts";
import { fetchTranscript } from "@/lib/youtube/transcript";
import { parseMediaLink } from "@/lib/youtube/url";
import { downloadBlob } from "@/lib/utils/download";

const PROVIDER_NAME: Record<AiSettings["provider"], string> = {
  anthropic: "Claude",
  openai: "OpenAI-compatible API",
  gemini: "Gemini",
  xai: "Grok",
  deepseek: "DeepSeek",
  ollama: "Ollama on this computer",
};

const LENGTHS = [1, 2, 3, 5];

interface Film {
  url: string;
  blob: Blob;
  title: string;
  seconds: number;
  script: DocScript;
  timeline: FilmTimeline;
}

/**
 * Paste a YouTube link, get the whole dialog (copy it, or save it as .txt or .srt), then turn it
 * into a narrated documentary: the visitor's own AI (Claude, with their key from the AI settings)
 * writes the script, the in-browser voice reads it, and the film is drawn and encoded on this
 * device. Only the transcript text goes to the AI provider they chose; no video leaves the device.
 */
export function DocumentaryDialog({ link, onClose, onOpenProject }: { link: string | null; onClose: () => void; /** Opens the editor on the project made from the finished film. */ onOpenProject?: (projectId: string) => void }) {
  const media = link ? parseMediaLink(link) : null;
  /** The caption language being fetched, and what the visitor is typing for the next try. */
  const [lang, setLang] = useState("en");
  const [langDraft, setLangDraft] = useState("en");
  const [attempt, setAttempt] = useState(0);
  /** What came back for one (link, language, attempt); anything else means a fetch is still running. */
  const [result, setResult] = useState<{ key: string; transcript: Transcript | null; error: string | null } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const key = `${link}|${lang}|${attempt}`;
  const settled = result?.key === key ? result : null;
  const loading = !!media && media.source === "youtube" && !settled;
  const transcript = settled?.transcript ?? null;
  const error = settled?.error ?? saveError;
  const [timestamps, setTimestamps] = useState(false);
  const [copied, setCopied] = useState(false);

  // Claude is the default writer; a choice already saved in the site's AI settings wins.
  const [ai, setAi] = useState<AiSettings>(() => {
    const saved = loadAiSettings();
    try {
      return localStorage.getItem("reelflow.ai") === null ? { ...saved, provider: "anthropic" } : saved;
    } catch {
      return saved;
    }
  });
  const [minutes, setMinutes] = useState(2);
  const [voice, setVoice] = useState(KOKORO_VOICES[0].id);
  const [height, setHeight] = useState<FilmHeight>(720);
  const [run, setRun] = useState<{ label: string; value: number | null } | null>(null);
  const [filmError, setFilmError] = useState<string | null>(null);
  const [film, setFilm] = useState<Film | null>(null);
  /** What "Open in editor" is doing right now, or null when idle. */
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const filmUrlRef = useRef<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const plainText = useMemo(() => (transcript ? cuesToText(transcript.cues) : ""), [transcript]);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch the captions whenever a link is opened (or the language is changed and retried).
  useEffect(() => {
    if (!media || media.source !== "youtube") return;
    const ctl = new AbortController();
    fetchTranscript(media, lang, ctl.signal)
      .then((t) => {
        setResult({ key, transcript: t, error: null });
        // English keeps the natural default narrator; other languages get their own voice.
        const spoken = TTS_VOICES.find((v) => v.lang === lang.slice(0, 2));
        if (spoken && spoken.lang !== "en") setVoice(spoken.id);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setResult({ key, transcript: null, error: e instanceof Error ? e.message : String(e) });
      });
    return () => ctl.abort();
    // `media` is a fresh object on every render; the key (link, language, attempt) is what identifies the request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const clearFilm = () => {
    if (filmUrlRef.current) URL.revokeObjectURL(filmUrlRef.current);
    filmUrlRef.current = null;
    setFilm(null);
  };
  const close = () => {
    abortRef.current?.abort();
    clearFilm();
    setRun(null);
    setFilmError(null);
    onClose();
  };
  useEffect(() => () => {
    if (filmUrlRef.current) URL.revokeObjectURL(filmUrlRef.current);
  }, []);

  const text = useMemo(() => (transcript ? cuesToText(transcript.cues, { timestamps }) : ""), [transcript, timestamps]);
  const updateAi = (patch: Partial<AiSettings>) => {
    setAi((old) => {
      const next = { ...old, ...patch };
      saveAiSettings(next);
      return next;
    });
  };
  const missing = aiMissing(ai);
  const voiceName = isKokoroVoice(voice) ? "English" : (TTS_VOICES.find((v) => v.id === voice)?.name ?? "English");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setSaveError("Your browser wouldn't let the page copy. Select the text and copy it by hand.");
    }
  };

  const make = async () => {
    if (!transcript) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    clearFilm();
    setFilmError(null);
    try {
      setRun({ label: `${PROVIDER_NAME[ai.provider]} is writing the script…`, value: null });
      const script = await writeDocumentaryScript(transcript.title, transcript.cues, { settings: ai, minutes, language: voiceName, signal: ctl.signal });
      const result = await renderFilm({
        script,
        voice,
        height,
        signal: ctl.signal,
        onProgress: (p) => {
          const value = p.phase === "voice" ? p.progress * 0.4 : p.phase === "video" ? 0.4 + p.progress * 0.55 : 0.95 + p.progress * 0.05;
          setRun({ label: p.message, value });
        },
      });
      const url = URL.createObjectURL(result.blob);
      filmUrlRef.current = url;
      setFilm({ url, blob: result.blob, title: script.title, seconds: result.duration, script, timeline: result.timeline });
    } catch (e) {
      if (!ctl.signal.aborted) setFilmError(e instanceof Error ? e.message : String(e));
    } finally {
      setRun(null);
    }
  };

  /** Saves the film as a project (16:9, like the film) and hands its id to the start screen, which opens the editor. */
  const openInEditor = async () => {
    if (!film || !onOpenProject) return;
    setOpenError(null);
    setOpening("Making the project…");
    const project = createProject({ name: film.title, formatId: "yt-landscape" });
    try {
      await saveProject(project);
      const file = new File([film.blob], transcriptFileName(film.title, "mp4"), { type: "video/mp4" });
      const { clip, blob } = await importVideo(file, project.id, (detail) => setOpening(detail || "Making the project…"));
      project.clips.push(clip);
      await updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
      await saveProject(project);
      await requestPersistentStorage();
      onOpenProject(project.id);
    } catch (e) {
      // Never leave an empty project behind on the start screen.
      await deleteProject(project.id).catch(() => undefined);
      setOpenError(e instanceof Error ? `Couldn't open the film in the editor: ${e.message}` : "Couldn't open the film in the editor.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <Modal open={!!link} onClose={close} title="Transcript and documentary" width={film ? "max-w-6xl" : "max-w-3xl"}>
      <div className="space-y-5 p-5" data-documentary>
        {loading && (
          <p className="flex items-center gap-2 text-sm text-white" role="status" data-documentary-loading>
            <Loader2 size={16} className="animate-spin text-sys-blue" aria-hidden /> Getting the captions from YouTube… the first request can take a minute if the helper was asleep.
          </p>
        )}

        {error && !loading && (
          <div className="space-y-2" role="alert" data-documentary-error>
            <p className="text-sm text-sys-red">{error}</p>
            <div className="flex flex-wrap items-center gap-2 text-[13px] text-label-2">
              <label htmlFor="doc-lang">Caption language code</label>
              <input id="doc-lang" value={langDraft} onChange={(e) => setLangDraft(e.target.value.trim())} className="h-8 w-20 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2 text-[13px] text-white" spellCheck={false} />
              <Button
                size="sm"
                onClick={() => {
                  setSaveError(null);
                  setLang(langDraft || "en");
                  setAttempt((n) => n + 1);
                }}
              >
                <RotateCcw size={13} /> Try again
              </Button>
            </div>
          </div>
        )}

        {transcript && (
          <section aria-labelledby="doc-transcript-title" className="space-y-2" data-documentary-transcript>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 id="doc-transcript-title" className="text-base font-semibold text-white [overflow-wrap:anywhere]">
                {transcript.title}
              </h3>
              <span className="text-xs text-label-3">{transcript.cues.length} caption lines</span>
            </div>
            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl border border-sys-gray4 bg-sys-gray5/50 p-3 text-[13px] leading-relaxed text-label-1" tabIndex={0} aria-label="Transcript text" data-documentary-text>
              {text}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => void copy()} data-documentary-copy>
                <Copy size={13} /> {copied ? "Copied" : "Copy text"}
              </Button>
              <Button size="sm" onClick={() => downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), transcriptFileName(transcript.title, "txt"))} data-documentary-txt>
                <FileText size={13} /> Download .txt
              </Button>
              <Button size="sm" onClick={() => downloadBlob(new Blob([cuesToSrt(transcript.cues)], { type: "application/x-subrip;charset=utf-8" }), transcriptFileName(transcript.title, "srt"))} data-documentary-srt>
                <Download size={13} /> Download .srt
              </Button>
              <label className="ml-auto flex items-center gap-1.5 text-[13px] text-label-2">
                <input type="checkbox" checked={timestamps} onChange={(e) => setTimestamps(e.target.checked)} /> Timestamps
              </label>
            </div>
          </section>
        )}

        {transcript && (
          <section aria-labelledby="doc-film-title" className="space-y-3 border-t border-sys-gray5 pt-5" data-documentary-film>
            <div>
              <h3 id="doc-film-title" className="flex items-center gap-2 text-base font-semibold text-white">
                <Clapperboard size={17} aria-hidden /> Make a mini documentary
              </h3>
              <p className="mt-0.5 text-[13px] text-label-3">
                {PROVIDER_NAME[ai.provider]} writes the script from this transcript, the narrator reads it, and the film is drawn on this device. Only the transcript text goes to {PROVIDER_NAME[ai.provider]}.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="space-y-1 text-[12px] font-semibold text-label-2">
                Length
                <Select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!!run} data-documentary-length>
                  {LENGTHS.map((m) => (
                    <option key={m} value={m}>
                      About {m} min
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-[12px] font-semibold text-label-2">
                Narrator voice
                <Select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!!run} data-documentary-voice>
                  <optgroup label="Natural English">
                    {KOKORO_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Basic voices (more languages)">
                    {TTS_VOICES.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </optgroup>
                </Select>
              </label>
              <label className="space-y-1 text-[12px] font-semibold text-label-2">
                Quality
                <Select value={height} onChange={(e) => setHeight(Number(e.target.value) as FilmHeight)} disabled={!!run} data-documentary-quality>
                  <option value={720}>720p</option>
                  <option value={1080}>1080p</option>
                </Select>
              </label>
            </div>

            <details className="rounded-xl border border-sys-gray4 bg-sys-gray5/40 p-3" open={!!missing} data-documentary-ai>
              <summary className="cursor-pointer text-[13px] font-semibold text-white">
                Script writer: {PROVIDER_NAME[ai.provider]} · {activeModel(ai)}
                {missing && <span className="ml-2 font-normal text-sys-orange">needs your key</span>}
              </summary>
              <div className="mt-3">
                <AiModelFields settings={ai} onChange={updateAi} disabled={!!run} />
              </div>
            </details>

            {!filmSupported() && <p className="text-sm text-sys-orange">This browser can&apos;t make videos here. Use Chrome, Edge or Safari.</p>}

            {run ? (
              <div className="space-y-2" role="status" aria-live="polite" data-documentary-progress>
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Loader2 size={16} className="shrink-0 animate-spin text-sys-blue" aria-hidden /> {run.label}
                </p>
                <ProgressBar value={run.value} className="h-2" />
                <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
                  <X size={12} /> Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" size="lg" onClick={() => void make()} disabled={!!missing || !filmSupported()} data-documentary-make>
                  <Clapperboard size={18} /> Create documentary
                </Button>
                {missing && <span className="text-[13px] text-sys-orange">{missing}</span>}
              </div>
            )}

            {filmError && (
              <p className="text-sm text-sys-red" role="alert" data-documentary-film-error>
                {filmError}
              </p>
            )}

            {film && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" data-documentary-result>
                <div className="space-y-2">
                <video ref={videoRef} src={film.url} controls className="w-full rounded-xl bg-black" aria-label={`${film.title}, the documentary`} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="primary" size="md" onClick={() => downloadBlob(film.blob, transcriptFileName(film.title, "mp4"))} data-documentary-download>
                    <Download size={15} /> Download MP4
                  </Button>
                  {onOpenProject && (
                    <Button variant="secondary" size="md" onClick={() => void openInEditor()} disabled={!!opening} data-documentary-edit>
                      {opening ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Scissors size={15} />} {opening ?? "Open in editor"}
                    </Button>
                  )}
                  <span className="text-xs text-label-3">
                    {film.title} · {Math.round(film.seconds)} s
                  </span>
                </div>
                {openError && (
                  <p className="text-sm text-sys-red" role="alert">
                    {openError}
                  </p>
                )}
                </div>
                <DocumentaryChat script={film.script} timeline={film.timeline} transcriptText={plainText} videoRef={videoRef} apiKey={ai.deepseekKey} model={ai.deepseekModel} onKey={(deepseekKey) => updateAi({ deepseekKey })} />
              </div>
            )}
          </section>
        )}
      </div>
    </Modal>
  );
}
