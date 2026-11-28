import { useEditor } from "@/store/editorStore";
import { getAsset } from "@/lib/storage/db";
import { loadImages } from "@/lib/export/images";
import { browserPreflightEnv, runPreflight, type PreflightIssue } from "@/lib/export/preflight";
import { exportProject, DEFAULT_EXPORT_OPTIONS, type ExportProgress } from "@/lib/ffmpeg/exporter";
import { acquireWakeLock } from "@/lib/mobile/share";
import { whileBusy } from "@/lib/utils/busy";
import type { FinishedExport } from "./phoneStore";

/**
 * Makes an MP4 of the currently open project with default settings, keeping it in memory
 * for the Instagram panel without saving to disk or triggering a download.
 */
export function exportForPhone(
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<FinishedExport> {
  return whileBusy(() => exportForPhoneInner(onProgress, signal));
}

async function exportForPhoneInner(
  onProgress: (p: ExportProgress) => void,
  signal: AbortSignal,
): Promise<FinishedExport> {
  const { project, assetUrls } = useEditor.getState();
  if (!project) throw new Error("No project is open.");

  const issues = await runPreflight(project, browserPreflightEnv(getAsset), {
    captionSource: DEFAULT_EXPORT_OPTIONS.captionSource,
    includeCaptions: DEFAULT_EXPORT_OPTIONS.includeCaptions,
    includeOverlays: DEFAULT_EXPORT_OPTIONS.includeOverlays,
  }).catch((): PreflightIssue[] => []);

  const blocker = issues.find((i) => i.severity === "error");
  if (blocker) throw new Error(`${blocker.title}. ${blocker.detail}`);

  if (signal.aborted) throw new DOMException("Stopped.", "AbortError");

  const releaseLock = await acquireWakeLock();
  try {
    const imageIds = project.overlays
      .filter((o) => o.kind === "image")
      .map((o) => (o as { assetId: string }).assetId);
    const images = await loadImages([...new Set(imageIds)]);

    const res = await exportProject(
      project,
      {
        getBlob: async (id) => (await getAsset(id))?.blob,
        getImage: (id) => images.get(id),
        urls: assetUrls,
      },
      DEFAULT_EXPORT_OPTIONS,
      onProgress,
      signal,
    );

    if (!res.video) throw new Error("The video could not be made.");

    return {
      video: res.video,
      loadVideo: null,
      fileName: res.fileName,
      bytes: res.bytes,
      streamed: false,
      inApp: true,
      at: Date.now(),
      project,
    };
  } finally {
    releaseLock();
  }
}
