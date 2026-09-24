"use client";
import { useEffect } from "react";
import { Lightbulb, GripHorizontal } from "lucide-react";
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
import { TimelineDock } from "@/components/timeline/TimelineDock";

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
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
    <div className="flex h-screen flex-col gap-2 overflow-hidden bg-[#0b0b0d] p-2.5 text-white">
      <TopBar />
      <NoticeStrip />
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
      <div className="flex h-3 shrink-0 items-center justify-center text-sys-gray2" aria-hidden>
        <GripHorizontal size={16} />
      </div>
      <TimelineDock />
    </div>
  );
}
