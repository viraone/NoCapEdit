"use client";
import { useEffect } from "react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { ensureFontsLoaded } from "@/lib/captions/fonts";
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
import { TransportBar } from "@/components/canvas/TransportBar";
import { TimelineDock } from "@/components/timeline/TimelineDock";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function EditorShell() {
  const tool = useEditor((s) => s.tool);
  const project = useEditor((s) => s.project);
  const assetUrls = useEditor((s) => s.assetUrls);

  useEffect(() => {
    engine.onTime = (t) => useEditor.getState().setTime(t);
    engine.onPlayingChange = (p) => useEditor.getState().setPlaying(p);
    ensureFontsLoaded();
    return () => {
      engine.onTime = null;
      engine.onPlayingChange = null;
    };
  }, []);

  useEffect(() => {
    if (project) engine.setProject(project, assetUrls);
  }, [project, assetUrls]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (e.code === "Space") {
        e.preventDefault();
        engine.toggle();
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
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <aside className="flex w-[21rem] shrink-0 flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-950">
          {tool === "clips" && <ClipsPanel />}
          {tool === "trim" && <TrimPanel />}
          {tool === "subtitles" && <SubtitlesPanel />}
          {tool === "style" && <StylePanel />}
          {tool === "text" && <TextPanel />}
          {tool === "picture" && <PicturePanel />}
          {tool === "music" && <MusicPanel />}
          {tool === "export" && <ExportPanel />}
        </aside>
        <main className="flex min-w-0 flex-1 flex-col bg-neutral-900/40">
          <CanvasBar />
          <VideoCanvas />
          <TransportBar />
        </main>
      </div>
      <TimelineDock />
    </div>
  );
}
