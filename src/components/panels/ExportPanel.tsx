"use client";
import { useRef, useState } from "react";
import { Download, Square, CheckCircle2, FileText, Cpu, HardDrive, Sparkles } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { getFormat } from "@/lib/models/formats";
import { projectDuration } from "@/lib/models/timeline";
import { getAsset } from "@/lib/storage/db";
import { exportProject, DEFAULT_EXPORT_OPTIONS, outputFrame, type ExportOptions, type ExportProgress, type ExportResult } from "@/lib/ffmpeg/exporter";
import { requestDiskSink, supportsDiskStreaming, type OutputSink } from "@/lib/ffmpeg/sinks";
import { supportsMultithread } from "@/lib/ffmpeg/loader";
import { RESOLUTION_PRESETS, type X264Preset } from "@/lib/ffmpegEngine";
import { GlTransitionRenderer } from "@/lib/gl/transitions";
import { needsCompositor } from "@/lib/playback/compositor";
import { downloadBlob, safeFilename } from "@/lib/utils/download";
import { formatBytes, formatTime } from "@/lib/utils/time";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { Toggle } from "@/components/ui/Toggle";
import { Slider } from "@/components/ui/Slider";
import { ProgressBar } from "@/components/ui/ProgressBar";

async function loadImages(assetIds: string[]): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(
    assetIds.map(async (id) => {
      const asset = await getAsset(id);
      if (!asset) return;
      const url = URL.createObjectURL(asset.blob);
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          map.set(id, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
    }),
  );
  return map;
}

const PRESET_CHOICES: { id: X264Preset; label: string }[] = [
  { id: "ultrafast", label: "Fastest" },
  { id: "veryfast", label: "Fast" },
  { id: "medium", label: "Balanced" },
  { id: "slow", label: "Best quality (slow)" },
];

export function ExportPanel() {
  const project = useProject();
  const assetUrls = useEditor((s) => s.assetUrls);
  const [opts, setOpts] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [toDisk, setToDisk] = useState(supportsDiskStreaming());
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const format = getFormat(project.formatId);
  const duration = projectDuration(project.clips);
  const frame = outputFrame(project, opts.resolution);
  const base = safeFilename(project.name);
  const hasTranslation = project.cues.some((c) => c.translatedText);
  const compositorNeeded = needsCompositor(project, 0, duration);
  const webgl = typeof window !== "undefined" && GlTransitionRenderer.isSupported();

  const run = async () => {
    setError(null);
    setResult(null);
    // The save dialog must open inside the click gesture, before any await.
    let sink: OutputSink | null = null;
    if (toDisk) {
      try {
        sink = await requestDiskSink(`${base}.mp4`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
      if (!sink) return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setProgress({ stage: "preparing", progress: 0, message: "Starting" });
    try {
      const imageIds = project.overlays.filter((o) => o.kind === "image").map((o) => (o as { assetId: string }).assetId);
      const images = await loadImages([...new Set(imageIds)]);
      const res = await exportProject(
        project,
        { getBlob: async (id) => (await getAsset(id))?.blob, getImage: (id) => images.get(id), urls: assetUrls },
        opts,
        setProgress,
        controller.signal,
        sink ?? undefined,
      );
      setResult(res);
      if (res.video) downloadBlob(res.video, res.fileName);
      if (res.srt) downloadBlob(res.srt, `${base}.srt`);
      if (res.txt) downloadBlob(res.txt, `${base}.txt`);
      if (res.vtt) downloadBlob(res.vtt, `${base}.vtt`);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") setError("Export cancelled.");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const running = !!progress;
  const set = (patch: Partial<ExportOptions>) => setOpts((o) => ({ ...o, ...patch }));
  const rc = opts.rateControl;

  return (
    <>
      <PanelHeader title="Export" description="Encoded by ffmpeg.wasm in a Web Worker on this device. Long renders stream to disk piece by piece." />
      <PanelSection title="Output">
        <Field label="Resolution" right={`${frame.width}×${frame.height}`}>
          <Select value={opts.resolution} onChange={(e) => set({ resolution: e.target.value as ExportOptions["resolution"] })} disabled={running}>
            {RESOLUTION_PRESETS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.id === "native" ? `${r.label} (${format.width}×${format.height})` : r.label}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Frame rate">
            <Select value={String(opts.fps)} onChange={(e) => set({ fps: Number(e.target.value) })} disabled={running}>
              <option value="24">24 fps</option>
              <option value="30">30 fps</option>
              <option value="60">60 fps</option>
            </Select>
          </Field>
          <Field label="Codec">
            <Select value={opts.codec} onChange={(e) => set({ codec: e.target.value as ExportOptions["codec"] })} disabled={running}>
              <option value="h264">H.264 (universal)</option>
              <option value="h265">H.265 / HEVC</option>
            </Select>
          </Field>
        </div>
        <Field label="Encoder speed">
          <Select value={opts.preset} onChange={(e) => set({ preset: e.target.value as X264Preset })} disabled={running}>
            {PRESET_CHOICES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Rate control">
          <Select value={rc.mode} onChange={(e) => set({ rateControl: e.target.value === "crf" ? { mode: "crf", crf: 23 } : { mode: "bitrate", kbps: 12000 } })} disabled={running}>
            <option value="crf">Constant quality (CRF)</option>
            <option value="bitrate">Target bitrate</option>
          </Select>
        </Field>
        {rc.mode === "crf" ? (
          <Slider label="Quality (lower = better)" value={rc.crf} min={14} max={32} step={1} format={(v) => `CRF ${v}`} onChange={(v) => set({ rateControl: { mode: "crf", crf: v } })} disabled={running} />
        ) : (
          <Slider label="Video bitrate" value={rc.kbps / 1000} min={2} max={80} step={0.5} format={(v) => `${v.toFixed(1)} Mbps`} onChange={(v) => set({ rateControl: { mode: "bitrate", kbps: Math.round(v * 1000) } })} disabled={running} />
        )}
        <Field label="HDR sources" hint="10-bit BT.2020 (PQ / HLG) clips are tone-mapped to SDR with zscale + tonemap so colours look right on every platform.">
          <Select value={opts.hdr} onChange={(e) => set({ hdr: e.target.value as ExportOptions["hdr"] })} disabled={running}>
            <option value="auto">Auto-detect and tone-map</option>
            <option value="tonemap">Always tone-map</option>
            <option value="passthrough">Never tone-map</option>
          </Select>
        </Field>
      </PanelSection>
      <PanelSection title="Layers">
        <Toggle checked={opts.includeCaptions} onChange={(v) => set({ includeCaptions: v })} label="Burn in captions" disabled={running} />
        {opts.includeCaptions && (
          <Field label="Caption language">
            <Select value={opts.captionSource} onChange={(e) => set({ captionSource: e.target.value as ExportOptions["captionSource"] })} disabled={running}>
              <option value="original">Original</option>
              <option value="translated" disabled={!hasTranslation}>
                Translated{hasTranslation ? "" : " (translate first)"}
              </option>
            </Select>
          </Field>
        )}
        <Toggle checked={opts.includeOverlays} onChange={(v) => set({ includeOverlays: v })} label="Include text and stickers" disabled={running} />
        <Toggle checked={opts.sidecars} onChange={(v) => set({ sidecars: v })} label="Also save .srt, .vtt and .txt" description="WebVTT includes word timings and speaker voices" disabled={running} />
      </PanelSection>
      <PanelSection title="Delivery">
        <Toggle
          checked={toDisk}
          onChange={setToDisk}
          label="Stream to a file on disk"
          description={supportsDiskStreaming() ? "Uses the File System Access API; needed for long 4K renders" : "Not supported by this browser; the file downloads when done"}
          disabled={running || !supportsDiskStreaming()}
        />
        <Field label="Segment length" hint="Each segment is encoded, then written out before the next starts, so memory stays flat.">
          <Select value={String(opts.segmentSeconds)} onChange={(e) => set({ segmentSeconds: Number(e.target.value) })} disabled={running}>
            <option value="0">Single pass (short videos)</option>
            <option value="10">10 s segments</option>
            <option value="20">20 s segments</option>
            <option value="40">40 s segments</option>
          </Select>
        </Field>
        <Field label="Render path">
          <Select value={opts.renderMode} onChange={(e) => set({ renderMode: e.target.value as ExportOptions["renderMode"] })} disabled={running}>
            <option value="auto">Auto ({compositorNeeded ? "compositor needed for GPU transitions / tracking" : "ffmpeg filters"})</option>
            <option value="filters">ffmpeg filters only</option>
            <option value="compositor">Canvas compositor (frame by frame)</option>
          </Select>
        </Field>
      </PanelSection>
      <PanelSection>
        <div className="space-y-1 text-[11px] text-label-3">
          <p className="flex items-center gap-1.5">
            <Cpu size={12} /> {supportsMultithread() ? "Multi-threaded encoder available" : "Single-threaded encoder (page is not cross-origin isolated)"}
          </p>
          <p className="flex items-center gap-1.5">
            <Sparkles size={12} /> {webgl ? "WebGL2 transitions available" : "WebGL2 unavailable: GPU transitions fall back to xfade"}
          </p>
          <p className="flex items-center gap-1.5">
            <HardDrive size={12} /> {formatTime(duration)} of video · {frame.width}×{frame.height} @ {opts.fps} fps
          </p>
        </div>
        {!running ? (
          <Button variant="primary" className="w-full" onClick={run} disabled={!project.clips.length}>
            <Download size={14} /> Export MP4
          </Button>
        ) : (
          <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
            <ProgressBar value={progress.stage === "loading" || progress.stage === "preparing" ? null : progress.progress} />
            <p className="text-[11px] text-label-2">{progress.message}</p>
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              <Square size={12} /> Cancel
            </Button>
          </div>
        )}
        {error && <p className="whitespace-pre-wrap text-[11px] text-sys-red">{error}</p>}
        {result && (
          <div className="space-y-2 rounded-lg border border-sys-green/40 bg-sys-green/10 p-2.5 text-[11px] text-label-2">
            <p className="flex items-center gap-1.5 text-sys-green">
              <CheckCircle2 size={13} /> Rendered in {result.seconds.toFixed(0)} s · {formatBytes(result.bytes)} · {result.segments} segment{result.segments === 1 ? "" : "s"}
              {result.streamed ? " · saved to disk" : ""}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {result.video && (
                <Button variant="secondary" size="xs" onClick={() => downloadBlob(result.video!, result.fileName)}>
                  <Download size={11} /> MP4
                </Button>
              )}
              {result.srt && (
                <Button variant="secondary" size="xs" onClick={() => downloadBlob(result.srt!, `${base}.srt`)}>
                  <FileText size={11} /> SRT
                </Button>
              )}
              {result.vtt && (
                <Button variant="secondary" size="xs" onClick={() => downloadBlob(result.vtt!, `${base}.vtt`)}>
                  <FileText size={11} /> VTT
                </Button>
              )}
              {result.txt && (
                <Button variant="secondary" size="xs" onClick={() => downloadBlob(result.txt!, `${base}.txt`)}>
                  <FileText size={11} /> TXT
                </Button>
              )}
            </div>
          </div>
        )}
      </PanelSection>
    </>
  );
}
