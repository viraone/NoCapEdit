"use client";
import { Film, Scissors, Captions, Palette, Type, Image as ImageIcon, Music, Share } from "lucide-react";
import { useEditor, type ToolId } from "@/store/editorStore";
import { cx } from "@/lib/utils/cx";

/** Apple system colours per tool, like the Halycol rail. */
const TOOLS: { id: ToolId; label: string; icon: React.ComponentType<{ size?: number }>; color: string }[] = [
  { id: "clips", label: "Clips", icon: Film, color: "#0a84ff" },
  { id: "trim", label: "Trim", icon: Scissors, color: "#ff453a" },
  { id: "subtitles", label: "Subtitles", icon: Captions, color: "#ffd60a" },
  { id: "style", label: "Style", icon: Palette, color: "#bf5af2" },
  { id: "text", label: "Text", icon: Type, color: "#ff9f0a" },
  { id: "picture", label: "Picture", icon: ImageIcon, color: "#ff375f" },
  { id: "music", label: "Music", icon: Music, color: "#64d2ff" },
  { id: "export", label: "Export", icon: Share, color: "#30d158" },
];

export function ToolRail() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const hasClips = useEditor((s) => (s.project?.clips.length ?? 0) > 0);
  return (
    <nav className="card flex w-[64px] shrink-0 flex-col items-stretch gap-1 p-1.5" aria-label="Tools">
      {TOOLS.map(({ id, label, icon: Icon, color }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            className={cx("relative flex flex-col items-center gap-1 rounded-[10px] px-1 py-2 text-[10px] font-semibold transition-colors", active ? "" : "hover:bg-sys-gray5")}
            style={active ? { background: `${color}22`, color } : { color: "rgba(235,235,245,0.75)" }}
            aria-current={active ? "page" : undefined}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: active ? color : `${color}26`, color: active ? "#000" : color }}>
              <Icon size={15} />
            </span>
            {label}
            {id === "clips" && hasClips && <span className="absolute right-2 top-1.5 h-1.5 w-1.5 rounded-full bg-sys-blue" />}
          </button>
        );
      })}
    </nav>
  );
}
