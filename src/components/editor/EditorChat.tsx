"use client";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { DocumentaryChat } from "@/components/start/DocumentaryChat";
import { filmTimeAt } from "@/lib/documentary/editorChat";
import { loadAiSettings, saveAiSettings, type AiSettings } from "@/lib/edit/aiHighlights";
import { engine } from "@/lib/playback/engine";
import { useEditor } from "@/store/editorStore";

/**
 * The documentary chat inside the editor, on the right of the picture. Shown only for a project that was
 * opened from a finished documentary (it carries the film's script). Asking pauses the editor's playback,
 * and the question is about the scene under the playhead, even after the film's clip was trimmed or split.
 */
export function EditorChat() {
  const doc = useEditor((s) => s.project?.documentary);
  // Whole seconds only, so playback re-renders the chat once a second, not on every frame.
  const now = useEditor((s) => (s.project?.documentary ? Math.floor(filmTimeAt(s.project.documentary, s.project.clips, s.currentTime)) : 0));
  const [open, setOpen] = useState(true);
  const [ai, setAi] = useState<AiSettings>(() => loadAiSettings());
  if (!doc) return null;

  const onAsk = () => {
    engine.pause();
    const s = useEditor.getState();
    return s.project?.documentary ? filmTimeAt(s.project.documentary, s.project.clips, s.currentTime) : 0;
  };
  const onKey = (deepseekKey: string) => {
    const next = { ...ai, deepseekKey };
    saveAiSettings(next);
    setAi(next);
  };

  return (
    <>
      {/* Hidden, not unmounted, so closing the column keeps the conversation. */}
      <aside className={open ? "flex w-[22rem] shrink-0 flex-col" : "hidden"} data-editor-chat>
        <DocumentaryChat script={doc.script} timeline={doc.timeline} transcriptText={doc.transcript} now={now} onAsk={onAsk} apiKey={ai.deepseekKey} model={ai.deepseekModel} onKey={onKey} fill onClose={() => setOpen(false)} />
      </aside>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="card order-last flex h-10 w-10 shrink-0 items-center justify-center self-start text-label-2 hover:text-white" aria-label="Ask about this film" title="Ask about this film" data-editor-chat-open>
          <MessageCircle size={18} />
        </button>
      )}
    </>
  );
}
