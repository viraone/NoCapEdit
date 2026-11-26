"use client";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useAiStyle } from "@/lib/phone/aiStyle";
import { useEditor } from "@/store/editorStore";

export function AiStyleCard() {
  const session = useAiStyle((s) => s.session);
  const again = useAiStyle((s) => s.again);
  const plain = useAiStyle((s) => s.plain);
  const shown = useEditor(
    (s) => !!session && s.project?.id === session.projectId && !!s.project.overlays.some((o) => o.id === session.overlayId),
  );
  if (!session || !shown) return null;
  return (
    <div className="mx-3 mt-3 space-y-2 rounded-2xl border border-sys-purple/40 bg-sys-purple/10 p-3" data-ai-style={session.state}>
      <p className="flex items-center gap-1.5 text-[13px] font-bold text-white">
        <Sparkles size={14} /> Style by DeepSeek
      </p>
      {session.state === "busy" && <p className="rf-read-note animate-pulse">DeepSeek is picking a look…</p>}
      {session.state === "done" && (
        <>
          <p className="rf-read-note">
            <span className="font-semibold text-white">{session.name}</span>
            {session.why ? ` · ${session.why}` : ""}
          </p>
          {session.name !== "Plain" && (
            <p className="rf-read-note">See it on the preview. Not for you? Try another, or change anything below.</p>
          )}
        </>
      )}
      {session.state === "error" && <p className="rf-read-note rf-error">{session.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {session.frame && (
          <Button variant="outline" size="xs" disabled={session.state === "busy"} onClick={() => void again()} data-ai-style-again>
            Try another
          </Button>
        )}
        <Button variant="ghost" size="xs" onClick={plain} data-ai-style-plain>
          Back to plain
        </Button>
        <Button variant="primary" size="xs" disabled={session.state === "busy"} onClick={() => useEditor.getState().setTool("instagram")} data-ai-style-keep>
          Keep it, go to Instagram
        </Button>
      </div>
    </div>
  );
}
