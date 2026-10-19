"use client";
import { useRef, useState } from "react";
import { CheckCircle2, Clapperboard, Download, FileVideo, Film, Square } from "lucide-react";
import { getAsset } from "@/lib/storage/db";
import { loadImages } from "@/lib/export/images";
import { DEFAULT_GIF_OPTIONS, DEFAULT_TRANSPARENT_OPTIONS, GIF_MAX_SECONDS, TRANSPARENT_MAX_SECONDS, exportGif, exportTransparent, gifProblem, transparentProblem, type GifOptions, type TransparentFormat } from "@/lib/export/altFormats";
import { exportTimelineBundle, type BundleResult } from "@/lib/export/nleBundle";
import { NLE_FPS } from "@/lib/export/nle";
import type { ExportOptions, ExportProgress } from "@/lib/ffmpeg/exporter";
import { createBlobSink, requestDiskSink, supportsDiskStreaming, type OutputSink } from "@/lib/ffmpeg/sinks";
import type { VideoProject } from "@/lib/models/project";
import { downloadBlob, safeFilename } from "@/lib/utils/download";
import { formatBytes } from "@/lib/utils/time";
import { PanelSection } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { ProgressBar } from "@/components/ui/ProgressBar";

type Job = "gif" | "transparent" | "timeline";

interface Done {
  job: Job;
  fileName: string;
  bytes: number;
  seconds: number;
  /** Kept so the file can be saved again; null when it was streamed straight to disk. */
  blob: Blob | null;
  notes?: string[];
}

const JOB_LABEL: Record<Job, string> = { gif: "GIF", transparent: "Transparent video", timeline: "Editor timeline" };

/** GIF, transparent video and the editor timeline: the exports that are not the MP4. */
export function ExportMore({ project, assetUrls, opts, busy, setBusy, blocked }: { project: VideoProject; assetUrls: Record<string, string>; opts: ExportOptions; busy: boolean; setBusy: (busy: boolean) => void; blocked: string | null }) {
  const [gif, setGif] = useState<Pick<GifOptions, "size" | "fps">>({ size: DEFAULT_GIF_OPTIONS.size, fps: DEFAULT_GIF_OPTIONS.fps });
  const [format, setFormat] = useState<TransparentFormat>(DEFAULT_TRANSPARENT_OPTIONS.format);
  const [fps, setFps] = useState<number>(30);
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const base = safeFilename(project.name);
  const disk = typeof window !== "undefined" && supportsDiskStreaming();

  const gifIssue = gifProblem(project);
  const clearIssue = transparentProblem(project, opts);

  const run = async (which: Job) => {
    if (busy) return;
    setError(null);
    setDone(null);
    if (blocked) {
      setError(blocked);
      return;
    }
    // The save dialog of the timeline package opens inside the click, before any await.
    let sink: OutputSink | null = null;
    if (which === "timeline" && disk) {
      try {
        sink = await requestDiskSink(`${base} timeline.zip`, { description: "Timeline package", accept: { "application/zip": [".zip"] } });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!sink) return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setJob(which);
    setBusy(true);
    setProgress({ stage: "preparing", progress: 0, message: "Starting" });
    try {
      const imageIds = [...new Set(project.overlays.filter((o) => o.kind === "image").map((o) => (o as { assetId: string }).assetId))];
      if (which === "gif") {
        const images = await loadImages(imageIds);
        const res = await exportGif(project, { getBlob: async (id) => (await getAsset(id))?.blob, getImage: (id) => images.get(id), urls: assetUrls }, { ...gif, includeCaptions: opts.includeCaptions, includeOverlays: opts.includeOverlays }, setProgress, controller.signal);
        downloadBlob(res.blob, res.fileName);
        setDone({ job: which, fileName: res.fileName, bytes: res.bytes, seconds: res.seconds, blob: res.blob });
      } else if (which === "transparent") {
        const images = await loadImages(imageIds);
        const res = await exportTransparent(project, (id) => images.get(id), { format, fps: opts.fps, resolution: opts.resolution, includeCaptions: opts.includeCaptions, includeOverlays: opts.includeOverlays }, setProgress, controller.signal);
        downloadBlob(res.blob, res.fileName);
        setDone({ job: which, fileName: res.fileName, bytes: res.bytes, seconds: res.seconds, blob: res.blob });
      } else {
        const started = performance.now();
        const out = sink ?? createBlobSink(`${base} timeline.zip`, "application/zip");
        let result: BundleResult;
        try {
          result = await exportTimelineBundle(
            project,
            { fps, getAsset, onProgress: (message, fraction) => setProgress({ stage: "writing", progress: fraction, message }) },
            out,
          );
        } catch (e) {
          await out.abort().catch(() => undefined);
          throw e;
        }
        const blob = await out.close();
        if (blob) downloadBlob(blob, `${base} timeline.zip`);
        setDone({ job: which, fileName: `${base} timeline.zip`, bytes: result.bytes, seconds: (performance.now() - started) / 1000, blob, notes: result.plan.notes });
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setError("Export cancelled.");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setProgress(null);
      setJob(null);
      setBusy(false);
    }
  };

  const running = job !== null;
  const lock = busy || running;

  return (
    <PanelSection title="More ways to export">
      <div className="space-y-3" data-export-more>
        <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-export-gif>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Film size={14} /> GIF
          </p>
          <p className="rf-read-note">A short looping clip for chats and posts. Up to {GIF_MAX_SECONDS} seconds. No sound.</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Size">
              <Select value={String(gif.size)} onChange={(e) => setGif((g) => ({ ...g, size: Number(e.target.value) as GifOptions["size"] }))} disabled={lock}>
                <option value="320">Small (320)</option>
                <option value="480">Medium (480)</option>
                <option value="640">Large (640)</option>
              </Select>
            </Field>
            <Field label="Frame rate">
              <Select value={String(gif.fps)} onChange={(e) => setGif((g) => ({ ...g, fps: Number(e.target.value) as GifOptions["fps"] }))} disabled={lock}>
                <option value="10">10 fps</option>
                <option value="12">12 fps</option>
                <option value="15">15 fps</option>
                <option value="20">20 fps</option>
              </Select>
            </Field>
          </div>
          {gifIssue && <p className="rf-read-note rf-warn">{gifIssue}</p>}
          <Button variant="secondary" className="w-full" onClick={() => run("gif")} disabled={lock || !!gifIssue} data-export-gif-run>
            <Download size={14} /> Make GIF
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-export-transparent>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <FileVideo size={14} /> Transparent video
          </p>
          <p className="rf-read-note">Captions, text and stickers on a clear background, to lay over footage in an editor. No picture or sound. Up to {TRANSPARENT_MAX_SECONDS} seconds.</p>
          <Field label="Format" hint="WebM (VP8 with transparency) plays in browsers and OBS. MOV (ProRes 4444) opens in Final Cut Pro, Premiere Pro and DaVinci Resolve; it is a much bigger file.">
            <Select value={format} onChange={(e) => setFormat(e.target.value as TransparentFormat)} disabled={lock}>
              <option value="webm">WebM (VP8 with transparency)</option>
              <option value="mov">MOV (ProRes 4444)</option>
            </Select>
          </Field>
          <p className="rf-read-note">Uses the resolution and frame rate chosen above.</p>
          {clearIssue && <p className="rf-read-note rf-warn">{clearIssue}</p>}
          <Button variant="secondary" className="w-full" onClick={() => run("transparent")} disabled={lock || !!clearIssue} data-export-transparent-run>
            <Download size={14} /> Export transparent video
          </Button>
        </div>

        <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-export-timeline>
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Clapperboard size={14} /> Editor timeline
          </p>
          <p className="rf-read-note">
            The cuts, speed, volume, dissolves, music, voice-overs and captions as a timeline for <b>Final Cut Pro</b>, <b>Premiere Pro</b> or <b>DaVinci Resolve</b>, with your original media. Nothing is re-encoded.
          </p>
          <Field label="Timeline frame rate">
            <Select value={String(fps)} onChange={(e) => setFps(Number(e.target.value))} disabled={lock}>
              {NLE_FPS.map((f) => (
                <option key={f} value={f}>
                  {f} fps
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="secondary" className="w-full" onClick={() => run("timeline")} disabled={lock || !project.clips.length} data-export-timeline-run>
            <Download size={14} /> Export timeline (.zip)
          </Button>
        </div>

        {running && progress && (
          <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-more-progress>
            <ProgressBar value={progress.stage === "loading" || progress.stage === "preparing" ? null : progress.progress} />
            <p className="rf-read-note">
              {JOB_LABEL[job]}: {progress.message}
            </p>
            {progress.notice && <p className="rf-read-note rf-warn">{progress.notice}</p>}
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              <Square size={12} /> Cancel
            </Button>
          </div>
        )}
        {error && <p className="rf-read-note rf-error whitespace-pre-wrap">{error}</p>}
        {done && (
          <div className="space-y-2 rounded-lg border border-sys-green/40 bg-sys-green/10 p-2.5" data-more-done>
            <p className="rf-read-note rf-ok flex items-center gap-1.5">
              <CheckCircle2 size={15} className="shrink-0" /> {JOB_LABEL[done.job]} ready · {formatBytes(done.bytes)} · {done.seconds.toFixed(0)} s{done.blob ? "" : " · saved to disk"}
            </p>
            {done.job === "timeline" && (
              <p className="rf-read-note">Unzip it, keep the media folder beside the timeline files, and open the .fcpxml (Final Cut Pro, DaVinci Resolve) or the .xml (Premiere Pro). The READ ME inside says how.</p>
            )}
            {done.notes && done.notes.length > 0 && (
              <div className="rf-read-note">
                <p className="font-semibold">Not exactly as here:</p>
                <ul className="list-disc space-y-0.5 pl-4">
                  {done.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
            {done.blob && (
              <Button variant="secondary" size="xs" onClick={() => downloadBlob(done.blob!, done.fileName)}>
                <Download size={11} /> Save again
              </Button>
            )}
          </div>
        )}
      </div>
    </PanelSection>
  );
}
