"use client";
import { useEffect } from "react";
import { AlertTriangle, Lightbulb, X } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { ensureFontsLoaded } from "@/lib/captions/fonts";
import { splitClipAt } from "@/lib/models/clipOps";
import { debugFlag } from "@/lib/ffmpeg/loader";
import { TopBar } from "./TopBar";
import { ToolRail } from "@/components/panels/ToolRail";
import { ClipsPanel } from "@/components/panels/ClipsPanel";
import { TrimPanel } from "@/components/panels/TrimPanel";
import { SubtitlesPanel } from "@/components/panels/SubtitlesPanel";
import { StylePanel } from "@/components/panels/StylePanel";
import { TextPanel } from "@/components/panels/TextPanel";
import { PicturePanel } from "@/components/panels/PicturePanel";
import { MusicPanel } from "@/components/panels/MusicPanel";
import { ExportPanel } from "@/components/panels/ExportPanel";
import { CanvasBar } from "@/components/canvas/CanvasBar";
import { VideoCanvas } from "@/components/canvas/VideoCanvas";
import { TimelineDock } from "@/components/timeline/TimelineDock";
import { TimelineResizeHandle } from "@/components/timeline/TimelineResizeHandle";
import { isNativeKeyOwner, isTextEntryTarget, isUndoRedoChord } from "./keyTargets";
import { createFocusModality, isActivatableTarget } from "./spaceShortcut";

/** True while a modal dialog (Recorder, New project, Delete project?) is open. */
function modalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]');
}

/** Files an import could not add. The Clips panel shows them itself; elsewhere (a top-bar import) they show here. */
function ImportErrorStrip() {
  const error = useEditor((s) => s.importError);
  const tool = useEditor((s) => s.tool);
  if (!error || tool === "clips") return null;
  return (
    <div className="flex shrink-0 items-start gap-2 rounded-lg bg-sys-red/10 px-3 py-1.5 text-[12px] text-sys-red" role="alert">
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 whitespace-pre-wrap">{error}</p>
      <button type="button" className="shrink-0 rounded p-0.5 hover:bg-sys-red/20" onClick={() => useEditor.getState().setImportError(null)} aria-label="Dismiss" title="Dismiss">
        <X size={13} />
      </button>
    </div>
  );
}

function NoticeStrip() {
  const notice = useEditor((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-sys-blue/10 px-3 text-[13px] text-white">
      <Lightbulb size={14} className="text-sys-blue" />
      {notice}
    </div>
  );
}

export function EditorShell() {
  const tool = useEditor((s) => s.tool);
  const project = useEditor((s) => s.project);
  const assetUrls = useEditor((s) => s.assetUrls);

  useEffect(() => {
    engine.onTime = (t) => useEditor.getState().setTime(t);
    engine.onPlayingChange = (p) => useEditor.getState().setPlaying(p);
    ensureFontsLoaded();
    // With reelflow.debug=1 the store and engine are reachable from test scripts.
    if (debugFlag("debug")) (window as unknown as { __nocap?: unknown }).__nocap = { useEditor, engine };
    return () => {
      engine.onTime = null;
      engine.onPlayingChange = null;
    };
  }, []);

  useEffect(() => {
    if (project) engine.setProject(project, assetUrls);
  }, [project, assetUrls]);

  useEffect(() => {
    const modality = createFocusModality();
    const onPointerDown = () => modality.pointerDown();
    const onPointerUp = () => modality.pointerUp();
    const onFocusIn = () => modality.focusIn();
    const onFocusOut = () => modality.focusOut();
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("focusout", onFocusOut, true);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") modality.tab();
      // A dialog (Recorder, New project, Delete project?) owns every shortcut while it is open.
      if (modalOpen()) return;
      if (isTextEntryTarget(e.target)) return;
      if (isNativeKeyOwner(e.target) && !isUndoRedoChord(e)) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      // Same action as the "Split at playhead" button (Clips / Trim panels).
      const splitAtPlayhead = () => {
        let ok = false;
        s.update((p) => void (ok = splitClipAt(p, s.currentTime) !== null));
        s.setNotice(ok ? "Split the clip at the playhead." : "Move the playhead inside a clip to split it.");
      };
      if (e.code === "Space") {
        if (e.defaultPrevented) return;
        // A keyboard-focused control (Tab, or a scripted .focus()) gets its own
        // native Space activation; a pointer-focused one keeps toggling playback.
        if (isActivatableTarget(e.target) && !modality.isPointerFocused()) return;
        e.preventDefault();
        engine.toggle();
      } else if (e.key.toLowerCase() === "s" && !mod && !e.altKey) {
        e.preventDefault();
        splitAtPlayhead();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        splitAtPlayhead();
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.redo();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        const sel = s.selection;
        if (!sel) return;
        e.preventDefault();
        s.update((p) => {
          if (sel.kind === "cue") p.cues = p.cues.filter((c) => c.id !== sel.id);
          if (sel.kind === "overlay") p.overlays = p.overlays.filter((o) => o.id !== sel.id);
          if (sel.kind === "clip") p.clips = p.clips.filter((c) => c.id !== sel.id);
          if (sel.kind === "voiceover") p.voiceovers = p.voiceovers.filter((v) => v.id !== sel.id);
        });
        s.select(null);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / 30;
        s.seek(s.currentTime + (e.key === "ArrowLeft" ? -step : step));
      } else if (e.key === "Home") {
        s.seek(0);
      } else if (e.key === "End") {
        s.seek(engine.duration);
      } else if (e.key === "Escape") {
        s.select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("focusout", onFocusOut, true);
    };
  }, []);

  return (
    <div className="flex h-screen flex-col gap-2 overflow-hidden bg-[#0b0b0d] p-2.5 text-white">
      <TopBar />
      <NoticeStrip />
      <ImportErrorStrip />
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex shrink-0 gap-3">
          <ToolRail />
          <aside className="card flex w-[22rem] flex-col overflow-y-auto">
            {tool === "clips" && <ClipsPanel />}
            {tool === "trim" && <TrimPanel />}
            {tool === "subtitles" && <SubtitlesPanel />}
            {tool === "style" && <StylePanel />}
            {tool === "text" && <TextPanel />}
            {tool === "picture" && <PicturePanel />}
            {tool === "music" && <MusicPanel />}
            {tool === "export" && <ExportPanel />}
          </aside>
        </div>
        <main className="flex min-w-0 flex-1 flex-col gap-2">
          <VideoCanvas />
          <CanvasBar />
        </main>
      </div>
      <TimelineResizeHandle />
      <TimelineDock />
    </div>
  );
}
