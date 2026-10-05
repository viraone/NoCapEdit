"use client";
import { useRef, useState } from "react";
import { AudioLines, Square, Undo2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import type { Clip } from "@/lib/models/project";
import { getAsset } from "@/lib/storage/db";
import { getSpeechAudio } from "@/lib/speech/audioCache";
import { findFeedbackTones, type FeedbackTone } from "@/lib/audio/feedback";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";

const hz = (f: number) => `${Math.round(f).toLocaleString("en-US")} Hz`;

/**
 * Mic feedback remover for one clip: scan finds tones that sit at one pitch,
 * Remove notches them out (live in the preview, and in the export).
 * Mount it with key={clip.id} so a different clip starts clean.
 */
export function FeedbackSection({ clip, edit }: { clip: Clip; edit: (fn: (c: Clip) => void) => void }) {
  const setNotice = useEditor((s) => s.setNotice);
  const [scan, setScan] = useState<{ progress: number | null } | null>(null);
  const [found, setFound] = useState<FeedbackTone[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const active = clip.feedbackNotches ?? [];

  const run = async () => {
    setError(null);
    setFound(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setScan({ progress: null });
    try {
      // The cleaned-up track if there is one, else the clip's own: what you hear is what gets scanned.
      const assetId = clip.audioAssetId ?? clip.assetId;
      const asset = await getAsset(assetId);
      if (!asset) throw new Error("The source file is missing.");
      const decoded = await getSpeechAudio(assetId, asset.blob);
      if (!decoded) throw new Error("This clip's audio could not be read. Files over 2 GB are too large to scan in the browser.");
      if (controller.signal.aborted) return;
      const tones = await findFeedbackTones(decoded.samples, decoded.sampleRate, {
        from: Math.max(0, clip.inPoint),
        to: Math.min(clip.duration, clip.outPoint),
        signal: controller.signal,
        onProgress: (f) => setScan({ progress: f }),
      });
      setFound(tones);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setScan(null);
    }
  };

  const remove = () => {
    if (!found?.length) return;
    const freqs = found.map((t) => t.freq);
    edit((c) => void (c.feedbackNotches = freqs));
    setFound(null);
    setNotice(`Removed ${freqs.length} feedback tone${freqs.length === 1 ? "" : "s"}. Play it to hear the difference; Put back undoes it.`);
  };

  return (
    <div className="space-y-2.5" data-feedback>
      <p className="rf-read-note">
        <b>Feedback</b> is a whistle that stays at one pitch. Scan finds it, then Remove cuts just those pitches.
      </p>
      {scan ? (
        <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
          <ProgressBar value={scan.progress} />
          <p className="rf-read-note">Listening for steady tones…</p>
          <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
            <Square size={12} /> Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="w-full" onClick={() => void run()} disabled={!clip.hasAudio} data-feedback-scan>
          <AudioLines size={13} /> Scan this clip for feedback
        </Button>
      )}
      {found && found.length === 0 && (
        <p className="rf-read-note rf-ok" data-feedback-none>
          <b>No feedback found.</b> This clip has no steady whistle.
        </p>
      )}
      {found && found.length > 0 && (
        <div className="space-y-2 rounded-lg border border-sys-orange/40 bg-sys-orange/10 p-2.5" data-feedback-found>
          <p className="rf-read-note">
            Found <b>{found.length === 1 ? "1 steady tone" : `${found.length} steady tones`}</b>: <span className="rf-mono">{found.map((t) => hz(t.freq)).join(" · ")}</span>
          </p>
          <Button variant="primary" size="sm" className="w-full" onClick={remove} data-feedback-remove>
            Remove {found.length === 1 ? "it" : "them"}
          </Button>
        </div>
      )}
      {active.length > 0 && (
        <div className="space-y-2 rounded-lg border border-sys-green/40 bg-sys-green/10 p-2.5" data-feedback-active>
          <p className="rf-read-note rf-ok">
            Removing <b>{active.length === 1 ? "1 tone" : `${active.length} tones`}</b>: <span className="rf-mono">{active.map(hz).join(" · ")}</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => edit((c) => void (c.feedbackNotches = []))} data-feedback-restore>
            <Undo2 size={12} /> Put back
          </Button>
        </div>
      )}
      {error && <p className="rf-read-note rf-error">{error}</p>}
    </div>
  );
}
