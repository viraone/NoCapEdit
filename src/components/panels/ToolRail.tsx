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
 * The rail fills the height it gets. Every tool gets an equal share of it;
 * its tile and icon grow to use that share (up to a cap), and labels appear
 * once a share has room for one under the tile. A timeline dragged very tall
 * still leaves small tiles that scroll inside the card.
 */
export interface RailLayout {
  labels: boolean;
  /** Icon tile, px square. */
  tile: number;
  icon: number;
  /** Rail width, px. */
  width: number;
  /** Vertical padding inside each tool button, px. */
  padY: number;
}
const RAIL_PAD = 8;
const GAP = 4;
/** Below this share per tool (px) a label would shrink the tile under 44 px: icons only, as big as they fit. */
const LABEL_SHARE = 80;
export function railLayout(height: number, tools = TOOLS.length): RailLayout {
  const share = (height - RAIL_PAD * 2) / tools;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.floor(v)));
  if (share >= LABEL_SHARE) {
    // Button: padding 6 + tile + 4 + 16 px label line + padding 6, then the gap.
    const tile = clamp(share - GAP - 32, 44, 48);
    return { labels: true, tile, icon: Math.round(tile * 0.54), width: Math.max(88, tile + 44), padY: 6 };
  }
  // Button: padding 3 + tile + padding 3, then the gap.
  const tile = clamp(share - GAP - 6, 26, 50);
  return { labels: false, tile, icon: Math.round(tile * 0.54), width: tile + 22, padY: 3 };
}

export function ToolRail() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  const hasClips = useEditor((s) => (s.project?.clips.length ?? 0) > 0);
  const ref = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(560);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The nav is stretched to the row's height, so its own height is what the tools may fill.
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height + RAIL_PAD * 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const lay = railLayout(height);
  return (
    <nav
      ref={ref}
      className="card no-scrollbar flex min-h-0 shrink-0 flex-col items-stretch overflow-y-auto"
      style={{ width: lay.width, padding: RAIL_PAD, gap: GAP }}
      aria-label="Tools"
      data-labels={lay.labels || undefined}
      data-tile={lay.tile}
    >
      {TOOLS.map(({ id, label, icon: Icon, color }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            className={cx("relative flex shrink-0 flex-col items-center gap-1 rounded-[12px] px-1 font-semibold leading-tight transition-colors", lay.tile >= 42 ? "text-[13px]" : "text-[12px]", active ? "" : "hover:bg-sys-gray5")}
            title={label}
            style={{ paddingTop: lay.padY, paddingBottom: lay.padY, ...(active ? { background: `${color}22`, color } : { color: "rgba(235,235,245,0.75)" }) }}
            aria-current={active ? "page" : undefined}
          >
            <span className="flex items-center justify-center" style={{ width: lay.tile, height: lay.tile, borderRadius: Math.round(lay.tile * 0.27), background: active ? color : `${color}26`, color: active ? "#000" : color }}>
              <Icon size={lay.icon} />
            </span>
            {lay.labels && label}
            {id === "clips" && hasClips && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-sys-blue ring-2 ring-[#1c1c1e]" />}
          </button>
        );
      })}
    </nav>
  );
}
