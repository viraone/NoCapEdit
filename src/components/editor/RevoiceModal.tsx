"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Mic, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Select } from "@/components/ui/Select";
import { drawAnimationFrame } from "@/lib/documentary/drawAnimation";
import { filmSupported, renderFilm } from "@/lib/documentary/film";
import { applyRevoice, filmHeightFor, filmStyle } from "@/lib/documentary/revoice";
import { transcriptFileName } from "@/lib/documentary/transcript";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { engine } from "@/lib/playback/engine";
import { KOKORO_VOICES } from "@/lib/speech/kokoro";
import { TTS_VOICES } from "@/lib/speech/tts";
import { useEditor } from "@/store/editorStore";

function voiceName(id: string): string {
  return KOKORO_VOICES.find((v) => v.id === id)?.name ?? TTS_VOICES.find((v) => v.id === id)?.name ?? id;
}

/** Re-renders a saved documentary with another narrator: same script, new voice and timing, one undo step. */
export function RevoiceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const abortRef = useRef<AbortController | null>(null);
  // Closing the dialog cancels a render that is still running.
  const close = () => {
    abortRef.current?.abort();
    onClose();
  };
  return (
    <Modal open={open} onClose={close} title="Change narrator voice" width="max-w-lg">
      <RevoiceBody abortRef={abortRef} onClose={close} />
    </Modal>
  );
}

function RevoiceBody({ abortRef, onClose }: { abortRef: { current: AbortController | null }; onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const doc = project?.documentary;
  const [voice, setVoice] = useState(doc?.voice ?? KOKORO_VOICES[0].id);
  const [run, setRun] = useState<{ label: string; value: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The dialog closing for any reason (the X, Escape, the backdrop) stops the run.
  useEffect(() => () => abortRef.current?.abort(), [abortRef]);

  if (!project || !doc) return null;

  const make = async () => {
    if (run) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setError(null);
    setRun({ label: "Getting ready…", value: 0 });
    const style = filmStyle(doc);
    const filmClip = project.clips.find((c) => c.assetId === doc.assetId);
    try {
      engine.pause();
      const result = await renderFilm({
        script: doc.script,
        voice,
        height: filmHeightFor(filmClip?.height ?? 1080),
        draw: style === "animation" ? drawAnimationFrame : undefined,
        signal: ctl.signal,
        onProgress: (p) => {
          if (ctl.signal.aborted) return;
          const value = p.phase === "voice" ? p.progress * 0.4 : p.phase === "video" ? 0.4 + p.progress * 0.55 : 0.95 + p.progress * 0.05;
          setRun({ label: p.message, value });
        },
      });
      if (ctl.signal.aborted) return;
      setRun({ label: "Adding the film to the project…", value: null });
      const file = new File([result.blob], transcriptFileName(doc.script.title, "mp4"), { type: "video/mp4" });
      const { clip, assetId, blob } = await importVideo(file, project.id, (message) => {
        if (!ctl.signal.aborted) setRun({ label: message || "Adding the film to the project…", value: null });
      });
      if (ctl.signal.aborted) return;
      useEditor.getState().registerAsset(assetId, blob);
      // One change, so one Undo puts the old film (and its old asset) back.
      useEditor.getState().update((p) => applyRevoice(p, { clip, timeline: result.timeline, voice, style }));
      updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
      useEditor.getState().setNotice(`The film now uses ${voiceName(voice)}. Undo brings the old one back.`);
      onClose();
    } catch (e) {
      if (!ctl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === ctl) abortRef.current = null;
      setRun(null);
    }
  };

  return (
    <div className="space-y-3" data-revoice-modal>
      <p className="text-[13px] leading-relaxed text-label-2">
        Makes the same film again with another voice. The script stays word for word; only the narration and the timing change.
      </p>
      {doc.voice && (
        <p className="text-[13px] text-label-2">
          Made with: <span className="font-semibold text-white">{voiceName(doc.voice)}</span>
        </p>
      )}
      <label className="block space-y-1 text-[12px] font-semibold text-label-2">
        Narrator voice
        <Select value={voice} onChange={(e) => setVoice(e.target.value)} disabled={!!run} data-revoice-voice>
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
      <p className="text-[11px] leading-relaxed text-label-3">
        Cuts made on the old film are not carried over, and captions keep their old timing. Undo brings the old film back.
      </p>
      {!filmSupported() && <p className="text-sm text-sys-orange">This browser can&apos;t make videos here. Use Chrome, Edge or Safari.</p>}
      {error && (
        <p className="whitespace-pre-wrap text-[12px] text-sys-red" role="alert">
          {error}
        </p>
      )}

      {run && (
        <div className="space-y-2" role="status" aria-live="polite" data-revoice-progress>
          <p className="flex items-center gap-2 text-sm font-semibold text-white">
            <Loader2 size={16} className="shrink-0 animate-spin text-sys-blue" aria-hidden /> {run.label}
          </p>
          <ProgressBar value={run.value} className="h-2" />
          <Button size="sm" variant="outline" onClick={() => abortRef.current?.abort()}>
            <X size={12} /> Cancel
          </Button>
        </div>
      )}

      <Button variant="primary" onClick={() => void make()} disabled={!!run || !filmSupported() || voice === doc.voice} data-revoice-run>
        <Mic size={16} /> Make with this voice
      </Button>
    </div>
  );
}
