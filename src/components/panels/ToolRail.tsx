"use client";
import { useEffect, useRef, useState } from "react";
import { Film, Scissors, Captions, Palette, Type, Image as ImageIcon, Music, Share, Clapperboard, Sparkles } from "lucide-react";
import { useEditor, type ToolId } from "@/store/editorStore";
import { useIsDesktopChrome } from "@/lib/ai/browser";
import { cx } from "@/lib/utils/cx";

/** Apple system colours per tool, like the Halycol rail. */
const TOOLS: { id: ToolId; label: string; hint: string; icon: React.ComponentType<{ size?: number }>; color: string }[] = [
  { id: "clips", label: "Clips", hint: "Import, order and split your videos", icon: Film, color: "#0a84ff" },
  { id: "trim", label: "Trim", hint: "Cut, speed, zoom and sound for a clip", icon: Scissors, color: "#ff453a" },
  { id: "subtitles", label: "Subtitles", hint: "Generate, translate and edit captions", icon: Captions, color: "#ffd60a" },
  { id: "style", label: "Style", hint: "How the captions look", icon: Palette, color: "#bf5af2" },
  { id: "text", label: "Text", hint: "Titles and banners on the video", icon: Type, color: "#ff9f0a" },
  { id: "picture", label: "Picture", hint: "Stickers, logos and images", icon: ImageIcon, color: "#ff375f" },
  { id: "music", label: "Music", hint: "Music, sound effects and voice-over", icon: Music, color: "#64d2ff" },
  { id: "reels", label: "Reels", hint: "Cut the best moments into short reels", icon: Clapperboard, color: "#ff375f" },
  { id: "post", label: "Post", hint: "Write the caption and hashtags for your post", icon: Sparkles, color: "#5e5ce6" },
  { id: "export", label: "Export", hint: "Render the finished video", icon: Share, color: "#30d158" },
];

/**
 * Name and one-line purpose of a tool, beside the rail while it is hovered or
 * keyboard-focused. Fixed to the viewport so the rail's scrolling card cannot
 * clip it; shows at once, unlike the browser's delayed title tooltip.
 */
function RailTip({ tip }: { tip: { id: ToolId; x: number; y: number } }) {
  const t = TOOLS.find((t) => t.id === tip.id)!;
  return (
    <div role="tooltip" id="tool-rail-tip" className="pointer-events-none fixed z-50 -translate-y-1/2" style={{ left: tip.x, top: tip.y }} data-rail-tip={t.id}>
      <span className="absolute -left-1 top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 border-b border-l border-sys-gray4 bg-sys-gray5" />
      <div className="relative max-w-80 rounded-lg border border-sys-gray4 bg-sys-gray5 px-3 py-2 shadow-xl shadow-black/50">
        <p className="text-[13px] font-semibold" style={{ color: t.color }}>
          {t.label}
        </p>
        <p className="rf-read-note">{t.hint}</p>
      </div>
    </div>
  );
}

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
  const [tip, setTip] = useState<{ id: ToolId; x: number; y: number } | null>(null);
  const showTip = (id: ToolId, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ id, x: r.right + 12, y: r.top + r.height / 2 });
  };
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // The nav is stretched to the row's height, so its own height is what the tools may fill.
    const ro = new ResizeObserver(([e]) => setHeight(e.contentRect.height + RAIL_PAD * 2));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Post uses Chrome's built-in AI, so only Chrome gets it.
  const chrome = useIsDesktopChrome();
  const tools = TOOLS.filter((t) => t.id !== "post" || chrome);
  const lay = railLayout(height, tools.length);
  return (
    <nav
      ref={ref}
      className="card no-scrollbar flex min-h-0 shrink-0 flex-col items-stretch overflow-y-auto"
      style={{ width: lay.width, padding: RAIL_PAD, gap: GAP }}
      aria-label="Tools"
      onScroll={() => setTip(null)}
      data-labels={lay.labels || undefined}
      data-tile={lay.tile}
    >
      {tools.map(({ id, label, icon: Icon, color }) => {
        const active = tool === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setTool(id)}
            onMouseEnter={(e) => showTip(id, e.currentTarget)}
            onMouseLeave={() => setTip(null)}
            onFocus={(e) => e.currentTarget.matches(":focus-visible") && showTip(id, e.currentTarget)}
            onBlur={() => setTip(null)}
            aria-label={label}
            aria-describedby={tip?.id === id ? "tool-rail-tip" : undefined}
            className={cx("relative flex shrink-0 flex-col items-center gap-1 rounded-[12px] px-1 font-semibold leading-tight transition-colors", lay.tile >= 42 ? "text-[13px]" : "text-[12px]", active ? "" : "hover:bg-sys-gray5")}
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
      {tip && <RailTip tip={tip} />}
    </nav>
  );
}
