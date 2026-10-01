"use client";
/**
 * Free music search (Openverse → Jamendo, Creative Commons). A result can be
 * previewed by streaming, or added: the MP3 is downloaded into the project's
 * local storage and becomes the background track, sized to the video.
 */
import { useEffect, useRef, useState } from "react";
import { Search, Play, Square, Plus, ExternalLink } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { importAudio } from "@/lib/media/import";
import { projectDuration } from "@/lib/models/timeline";
import { creditFor, downloadTrack, licenseLabel, searchMusic, type MusicResult } from "@/lib/stock/openverse";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";
import { Toggle } from "@/components/ui/Toggle";
import { ProgressBar } from "@/components/ui/ProgressBar";

export function MusicSearch() {
  const project = useProject();
  const { update, registerAsset, setNotice } = useEditor.getState();
  const [query, setQuery] = useState("");
  const [commercialOnly, setCommercialOnly] = useState(true);
  const [results, setResults] = useState<MusicResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ id: string; progress: number | null } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const searchAbort = useRef<AbortController | null>(null);

  const stopPreview = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    setPreviewId(null);
  };
  useEffect(() => stopPreview, []);

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setSearching(true);
    setError(null);
    try {
      const out = await searchMusic(q, { commercialOnly, signal: controller.signal });
      setResults(out.results);
      setTotal(out.total);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (searchAbort.current === controller) setSearching(false);
    }
  };

  const preview = (track: MusicResult) => {
    if (previewId === track.id) {
      stopPreview();
      return;
    }
    stopPreview();
    const audio = new Audio(track.url);
    audio.crossOrigin = "anonymous";
    audio.volume = 0.8;
    audio.onended = stopPreview;
    audio.onerror = () => {
      stopPreview();
      setError("The preview could not be played.");
    };
    audioRef.current = audio;
    setPreviewId(track.id);
    audio.play().catch(() => stopPreview());
  };

  const add = async (track: MusicResult) => {
    stopPreview();
    setError(null);
    setAdding({ id: track.id, progress: null });
    try {
      const blob = await downloadTrack(track, (p) => setAdding({ id: track.id, progress: p }));
      const safe = `${track.title} - ${track.artist}`.replace(/[\\/:*?"<>|]+/g, " ").trim();
      const file = new File([blob], `${safe}.mp3`, { type: "audio/mpeg" });
      const { assetId, duration, blob: stored } = await importAudio(file, project.id);
      registerAsset(assetId, stored);
      const videoLength = projectDuration(useEditor.getState().project?.clips ?? []);
      // Sized to the video: a longer track is cut at the video's end, a
      // shorter one loops to fill it, with a short fade-out at the end.
      update((p) => void (p.music = { assetId, name: safe, duration: duration || track.duration, volume: 0.35, fadeIn: 0, fadeOut: 1, startOffset: 0, loop: true, credit: creditFor(track) }));
      setNotice(`Added "${track.title}" by ${track.artist}, trimmed to ${formatTime(videoLength)} to match the video.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="space-y-2.5" data-music-search>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          search();
        }}
      >
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search free music: halloween, lo-fi, upbeat…" aria-label="Search free music" />
        <Button type="submit" variant="secondary" size="md" disabled={searching || !query.trim()} aria-label="Search">
          <Search size={15} />
        </Button>
      </form>
      <Toggle checked={commercialOnly} onChange={setCommercialOnly} label="Commercial use OK only" description="CC BY / BY-SA tracks; off also shows non-commercial (BY-NC) and no-derivatives (BY-ND) tracks" />
      {error && <p className="rf-read-note rf-error">{error}</p>}
      {searching && <ProgressBar value={null} />}
      {results && !searching && (
        <p className="rf-read-note">
          {total ? `${total.toLocaleString()} tracks on Openverse (Jamendo, Creative Commons)` : "No tracks found. Try another word, or switch off the commercial filter."}
        </p>
      )}
      {results && results.length > 0 && (
        <ul className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {results.map((t) => {
            const busy = adding?.id === t.id;
            return (
              <li key={t.id} data-music-result={t.id} className={cx("rounded-lg border border-sys-gray4 bg-sys-gray5 p-2", previewId === t.id && "border-sys-blue")}>
                <div className="flex items-center gap-2">
                  <button type="button" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sys-gray4 text-white hover:bg-sys-gray3" onClick={() => preview(t)} title={previewId === t.id ? "Stop preview" : "Preview"} aria-label={previewId === t.id ? "Stop preview" : "Preview"}>
                    {previewId === t.id ? <Square size={13} /> : <Play size={13} />}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="rf-read-face truncate text-[14px] font-semibold text-white">{t.title}</p>
                    <p className="truncate text-[12px] text-white/70">
                      {t.artist} · {formatTime(t.duration)}
                      {t.genres.length ? ` · ${t.genres.slice(0, 2).join(", ")}` : ""}
                    </p>
                  </div>
                  <span className={cx("shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold", t.commercial ? "bg-sys-green/15 text-sys-green" : "bg-sys-orange/15 text-sys-orange")} title={t.commercial ? "Usable in commercial posts with credit" : "Non-commercial or no-derivatives licence"}>
                    {licenseLabel(t.license)}
                  </span>
                  <a href={t.pageUrl} target="_blank" rel="noreferrer" className="shrink-0 text-label-3 hover:text-white" title="Open on Jamendo">
                    <ExternalLink size={13} />
                  </a>
                  <Button variant="primary" size="sm" onClick={() => add(t)} disabled={!!adding || !project.clips.length} title="Download and set as the background track, sized to the video">
                    <Plus size={13} /> Add
                  </Button>
                </div>
                {busy && (
                  <div className="mt-2">
                    <ProgressBar value={adding.progress} />
                    <p className="rf-read-note mt-1">Downloading…</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
