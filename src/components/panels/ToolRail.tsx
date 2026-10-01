"use client";
import { useEffect, useRef, useState } from "react";
import { Film, Scissors, Captions, Palette, Type, Image as ImageIcon, Music, Share, Clapperboard } from "lucide-react";
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
  { id: "reels", label: "Reels", icon: Clapperboard, color: "#ff375f" },
  { id: "export", label: "Export", icon: Share, color: "#30d158" },
];

/**
 * The rail sizes itself to the height it gets: large tiles and 12 px labels
 * when there is room, the tighter original size on a normal screen, and
 * icons only (scrolling inside the card, no scrollbar) when the timeline is
 * dragged so tall that not even those fit.
 */
type Size = "lg" | "md" | "sm";
/** Height one tool needs at each size (button plus gap, measured in Chromium: 78 and 57 px) and the card padding around the column. */
const NEEDS: Record<Size, { tool: number; pad: number }> = { lg: { tool: 78, pad: 16 }, md: { tool: 57, pad: 12 }, sm: { tool: 0, pad: 12 } };
export function railSize(height: number): Size {
  if (height >= TOOLS.length * NEEDS.lg.tool + NEEDS.lg.pad) return "lg";
  if (height >= TOOLS.length * NEEDS.md.tool + NEEDS.md.pad) return "md";
  return "sm";
}

export function ToolRail() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const hasClips = useEditor((s) => (s.project?.clips.length ?? 0) > 0);
  const ref = useRef<HTMLElement>(null);
  const [size, setSize] = useState<Size>("md");
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize(railSize(e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lg = size === "lg";
  const compact = size === "sm";
  return (
    <nav
      ref={ref}
      className={cx("card no-scrollbar flex min-h-0 shrink-0 flex-col items-stretch overflow-y-auto", lg ? "w-[92px] gap-1.5 p-2" : "w-[76px] p-1.5", size === "md" && "gap-1", compact && "gap-0.5")}
      aria-label="Tools"
      data-size={size}
      data-compact={compact || undefined}
    >
      {TOOLS.map(({ id, label, icon: Icon, color }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            className={cx("relative flex shrink-0 flex-col items-center rounded-[10px] px-1 font-semibold transition-colors", lg ? "gap-1.5 py-2.5 text-[13px] leading-tight" : "gap-1 text-[11.5px] leading-tight", size === "md" && "py-1.5", compact && "py-1", active ? "" : "hover:bg-sys-gray5")}
            title={label}
            style={active ? { background: `${color}22`, color } : { color: "rgba(235,235,245,0.75)" }}
            aria-current={active ? "page" : undefined}
          >
            <span className={cx("flex items-center justify-center", lg ? "h-11 w-11 rounded-xl" : "h-8 w-8 rounded-lg")} style={{ background: active ? color : `${color}26`, color: active ? "#000" : color }}>
              <Icon size={lg ? 24 : 19} />
            </span>
            {!compact && label}
            {id === "clips" && hasClips && <span className={cx("absolute h-1.5 w-1.5 rounded-full bg-sys-blue", lg ? "right-2.5 top-2" : "right-2 top-1.5")} />}
          </button>
        );
      })}
    </nav>
  );
}
