"use client";
import { Film, Scissors, Captions, Palette, Type, Image as ImageIcon, Music, Download } from "lucide-react";
import { useEditor, type ToolId } from "@/store/editorStore";
import { cx } from "@/lib/utils/cx";

const TOOLS: { id: ToolId; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: "clips", label: "Clips", icon: Film },
  { id: "trim", label: "Trim", icon: Scissors },
  { id: "subtitles", label: "Subtitles", icon: Captions },
  { id: "style", label: "Style", icon: Palette },
  { id: "text", label: "Text", icon: Type },
  { id: "picture", label: "Picture", icon: ImageIcon },
  { id: "music", label: "Music", icon: Music },
  { id: "export", label: "Export", icon: Download },
];

export function ToolRail() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <nav className="flex w-16 shrink-0 flex-col items-stretch gap-1 border-r border-neutral-800 bg-neutral-950 px-1.5 py-2" aria-label="Tools">
      {TOOLS.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => setTool(id)}
          className={cx(
            "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[10px] font-medium transition-colors",
            tool === id ? "bg-brand-500/15 text-brand-300" : "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100",
          )}
          aria-current={tool === id ? "page" : undefined}
        >
          <Icon size={18} />
          {label}
        </button>
      ))}
    </nav>
  );
}
