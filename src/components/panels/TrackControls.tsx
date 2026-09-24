"use client";
import { useRef, useState } from "react";
import { Crosshair, Square, Undo2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import type { Overlay } from "@/lib/models/project";
import { overlayCenter } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { trackPoint } from "@/lib/tracking/templateTracker";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";

/** "Track motion" controls shared by the Text and Picture panels. */
export function TrackControls({ overlay }: { overlay: Overlay }) {
  const [job, setJob] = useState<{ message: string; progress: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = async () => {
    const state = useEditor.getState();
    const project = state.project;
    if (!project) return;
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ message: "Starting", progress: null });
    try {
      const format = getFormat(project.formatId);
      const from = Math.max(overlay.start, Math.min(state.currentTime, overlay.end - 0.2));
      const point = overlayCenter(overlay, from);
      const keyframes = await trackPoint({
        clips: project.clips,
        urls: state.assetUrls,
        frame: { width: format.width, height: format.height },
        from,
        to: overlay.end,
        point,
        signal: controller.signal,
        onProgress: (message, progress) => setJob({ message, progress }),
      });
      state.update((p) => {
        const o = p.overlays.find((o) => o.id === overlay.id);
        if (!o) return;
        const first = keyframes[0];
        o.track = { keyframes, offset: { x: point.x - first.x, y: point.y - first.y } };
      });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setJob(null);
    }
  };

  const clear = () =>
    useEditor.getState().update((p) => {
      const o = p.overlays.find((o) => o.id === overlay.id);
      if (!o) return;
      const c = overlayCenter(o, o.start);
      o.x = c.x;
      o.y = c.y;
      o.track = null;
    });

  return (
    <div className="space-y-2">
      {overlay.track ? (
        <div className="flex items-center justify-between rounded-md border border-sys-green/40 bg-sys-green/10 px-2 py-1.5 text-[11px] text-sys-green">
          <span>Locked to motion ({overlay.track.keyframes.length} keyframes)</span>
          <Button variant="ghost" size="xs" onClick={clear}>
            <Undo2 size={11} /> Unlock
          </Button>
        </div>
      ) : job ? (
        <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
          <ProgressBar value={job.progress} />
          <p className="text-[11px] text-label-2">{job.message}</p>
          <Button variant="outline" size="xs" onClick={() => abortRef.current?.abort()}>
            <Square size={11} /> Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" className="w-full" onClick={run}>
          <Crosshair size={13} /> Track motion from the playhead
        </Button>
      )}
      <p className="text-[11px] text-label-3">Place the element over the subject, then track: it follows whatever is under its centre until the element ends. Drag it afterwards to adjust the offset.</p>
      {error && <p className="text-[11px] text-sys-red">{error}</p>}
    </div>
  );
}
