"use client";
import { useEffect } from "react";
import { AlertTriangle, Lightbulb, X } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { ensureFontsLoaded } from "@/lib/captions/fonts";
import { splitClipAt, captionsClearedNotice, removeClip } from "@/lib/models/clipOps";
import { removeMusicSelection, removedMusicNotice } from "@/lib/models/musicTrim";
import { debugFlag } from "@/lib/ffmpeg/loader";
import { TopBar } from "./TopBar";
import { EditorChat } from "./EditorChat";
import { EditorNotes } from "./EditorNotes";
import { InstagramPanel } from "@/components/phone/InstagramPanel";
import { PhonePanel } from "@/components/phone/PhonePanel";
import { phoneBridge } from "@/lib/phone/phoneBridge";
import { cx } from "@/lib/utils/cx";
import { useFitPictureToSong, useStillLength } from "@/components/panels/useStillLength";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ToolRail } from "@/components/panels/ToolRail";
import { ClipsPanel } from "@/components/panels/ClipsPanel";
import { TrimPanel } from "@/components/panels/TrimPanel";
import { SubtitlesPanel } from "@/components/panels/SubtitlesPanel";
import { TranscriptPanel } from "@/components/panels/TranscriptPanel";
import { StylePanel } from "@/components/panels/StylePanel";
import { TextPanel } from "@/components/panels/TextPanel";
import { PicturePanel } from "@/components/panels/PicturePanel";
import { MusicPanel } from "@/components/panels/MusicPanel";
import { ExportPanel } from "@/components/panels/ExportPanel";
import { ReelsPanel } from "@/components/panels/ReelsPanel";
import { PanelHeader } from "@/components/ui/Panel";
import { PostPanel } from "@/components/panels/PostPanel";
import { ReframePanel } from "@/components/panels/ReframePanel";
import { CanvasBar } from "@/components/canvas/CanvasBar";
import { VideoCanvas } from "@/components/canvas/VideoCanvas";
import { TimelineDock } from "@/components/timeline/TimelineDock";
import { TimelineResizeHandle } from "@/components/timeline/TimelineResizeHandle";
import { shortcutFor } from "@/lib/shortcuts";
import { focusModality, isActivatableTarget } from "./spaceShortcut";

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

/** Shown on every panel while a picture is being made as long as the song (it takes a few seconds), or when that failed. */
function StillLengthStrip() {
  const { status, error } = useStillLength();
  if (!status && !error) return null;
  return (
    <div className="flex shrink-0 items-center gap-3 rounded-lg bg-sys-blue/10 px-3 py-1.5 text-[13px] text-white" role={error ? "alert" : "status"}>
      <Lightbulb size={14} className="shrink-0 text-sys-blue" />
      {status ? (
        <>
          <span className="shrink-0">Making the picture as long as your song · {status}</span>
          <div className="min-w-0 flex-1">
            <ProgressBar value={null} />
          </div>
        </>
      ) : (
        <p className="min-w-0 flex-1 whitespace-pre-wrap text-sys-red">{error}</p>
      )}
    </div>
  );
}

export function EditorShell() {
  const tool = useEditor((s) => s.tool);
  const panelOpen = useEditor((s) => s.panelOpen);
  const setPanelOpen = useEditor((s) => s.setPanelOpen);
  const project = useEditor((s) => s.project);
  const assetUrls = useEditor((s) => s.assetUrls);
  useFitPictureToSong();
  // The desktop app's panel look. Export adds its own and Instagram is drawn that way already.
  const skin = !!phoneBridge() && tool !== "export" && tool !== "instagram";

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
    // One tracker for the whole app: controls that emulate a button (a timeline
    // clip) read the same instance to tell keyboard focus from a click.
    const modality = focusModality;
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
      // The key map (with the text-field guards) lives in src/lib/shortcuts.ts.
      const action = shortcutFor(e);
      if (!action) return;
      const s = useEditor.getState();
      switch (action) {
        case "play-pause":
          // A keyboard-focused control (Tab, or a scripted .focus()) gets its own
          // native Space activation; a pointer-focused one keeps toggling playback.
          if (isActivatableTarget(e.target) && !modality.isPointerFocused()) return;
          e.preventDefault();
          engine.toggle();
          break;
        case "split-at-playhead":
          // Same action as the "Split at playhead" button (Clips / Trim panels).
          e.preventDefault();
          {
            let ok = false;
            s.update((p) => void (ok = splitClipAt(p, s.currentTime) !== null));
            s.setNotice(ok ? "Split the clip at the playhead." : "Move the playhead inside a clip to split it.");
          }
          break;
        case "undo":
          e.preventDefault();
          s.undo();
          break;
        case "redo":
          e.preventDefault();
          s.redo();
          break;
        case "remove-selection": {
          const sel = s.selection;
          if (!sel) break;
          e.preventDefault();
          let cleared = 0;
          let music = null as "piece" | "song" | null;
          s.update((p) => {
            if (sel.kind === "music") music = removeMusicSelection(p, Number(sel.id));
            if (sel.kind === "cue") p.cues = p.cues.filter((c) => c.id !== sel.id);
            if (sel.kind === "overlay") p.overlays = p.overlays.filter((o) => o.id !== sel.id);
            if (sel.kind === "clip") cleared = removeClip(p, sel.id).clearedCaptions;
            if (sel.kind === "voiceover") p.voiceovers = p.voiceovers.filter((v) => v.id !== sel.id);
          });
          s.select(null);
          if (music) s.setNotice(removedMusicNotice(music));
          if (cleared) s.setNotice(captionsClearedNotice(cleared));
          break;
        }
        case "seek-back":
        case "seek-forward": {
          e.preventDefault();
          const step = e.shiftKey ? 1 : 1 / 30;
          s.seek(s.currentTime + (action === "seek-back" ? -step : step));
          break;
        }
        case "seek-start":
          s.seek(0);
          break;
        case "seek-end":
          s.seek(engine.duration);
          break;
        case "clear-selection":
          s.select(null);
          break;
        case "zoom-in":
        case "zoom-out":
          // The same 1.4× step the timeline's Zoom buttons use.
          e.preventDefault();
          s.setTimelineZoom(s.timelineZoom * (action === "zoom-in" ? 1.4 : 1 / 1.4));
          break;
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
      <StillLengthStrip />
      <ImportErrorStrip />
      {/* The phone panel (desktop app) is a column of its own, the full height beside the editor and the timeline. */}
      <div className="flex min-h-0 flex-1 gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex min-h-0 flex-1 gap-3">
            <div className="flex shrink-0 gap-3">
              <ToolRail />
              {panelOpen && (
                /* Keyed by tool so each one opens at its top, not where the last one was scrolled to. */
                <aside key={tool} className={cx("rf-panel card relative flex w-[24rem] flex-col overflow-y-auto", skin && "rf-skin")}>
                  <button type="button" data-tool-panel-close aria-label="Close panel" title="Close panel" onClick={() => setPanelOpen(false)} className="sticky top-2 z-20 -mb-9 mr-2 mt-2 grid h-7 w-7 shrink-0 place-items-center self-end rounded-md text-muted hover:bg-white/10 hover:text-white">
                    <X size={16} />
                  </button>
                  {tool === "clips" && <ClipsPanel />}
                  {tool === "trim" && <TrimPanel />}
                  {tool === "subtitles" && <SubtitlesPanel />}
                  {tool === "transcript" && <TranscriptPanel />}
                  {tool === "style" && <StylePanel />}
                  {tool === "text" && <TextPanel />}
                  {tool === "picture" && <PicturePanel />}
                  {tool === "music" && <MusicPanel />}
                  {tool === "reels" && <ReelsPanel />}
                  {tool === "recap" && <PanelHeader title="Recap Highlight Reel" body={<p className="rf-read" data-recap-placeholder>Nothing here yet.</p>} />}
                  {tool === "post" && <PostPanel />}
                  {tool === "reframe" && <ReframePanel />}
                  {tool === "export" && <ExportPanel />}
                  {tool === "instagram" && <InstagramPanel />}
                </aside>
              )}
            </div>
            <main className="flex min-w-0 flex-1 flex-col gap-2">
              <VideoCanvas />
              <CanvasBar />
            </main>
            <EditorChat />
            <EditorNotes />
          </div>
          <TimelineResizeHandle />
          <TimelineDock />
        </div>
        <PhonePanel />
      </div>
    </div>
  );
}
