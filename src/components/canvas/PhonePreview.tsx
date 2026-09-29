"use client";
/**
 * Phone preview: the live composition inside an iPhone 16 Pro Max mock-up
 * (440 × 956 pt screen, Dynamic Island) showing how the post reads in the
 * Instagram app, as a feed post (media cropped to 4:5 like Instagram does)
 * or as a Reel (full screen with the overlaid UI). The media area mirrors the
 * editor's preview canvas every frame, so playback, captions and stickers
 * all show up. Username and caption are editable and remembered locally.
 */
import { useEffect, useRef, useState } from "react";
import { X, Heart, MessageCircle, Send, Bookmark, MoreHorizontal, Home, Search, PlusSquare, Clapperboard, Music, Smartphone } from "lucide-react";
import { getPreviewCanvas } from "@/components/CanvasRenderer";
import { useEditor } from "@/store/editorStore";
import { getFormat } from "@/lib/models/formats";
import { cx } from "@/lib/utils/cx";

/** iPhone 16 Pro Max logical screen size in CSS points. */
const SCREEN_W = 440;
const SCREEN_H = 956;
const BEZEL = 14;
const STORAGE_KEY = "reelflow.phonePreview";

type View = "feed" | "reels";

interface Persona {
  username: string;
  caption: string;
}

function loadPersona(fallbackCaption: string): Persona {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { username: "rickshawlounge", caption: fallbackCaption, ...(JSON.parse(raw) as Partial<Persona>) };
  } catch {
    /* ignore */
  }
  return { username: "rickshawlounge", caption: fallbackCaption };
}

/** Mirrors the editor's preview canvas into a box, cover-cropped to the box's aspect. */
function MediaMirror({ width, height, className }: { width: number; height: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    const loop = () => {
      const src = getPreviewCanvas();
      if (src && src.width && src.height) {
        const target = canvas.width / canvas.height;
        const source = src.width / src.height;
        let sx = 0;
        let sy = 0;
        let sw = src.width;
        let sh = src.height;
        if (source > target) {
          sw = src.height * target;
          sx = (src.width - sw) / 2;
        } else {
          sh = src.width / target;
          sy = (src.height - sh) / 2;
        }
        ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [width, height]);
  return <canvas ref={ref} className={className} style={{ width, height }} />;
}

function StatusBar({ dark }: { dark: boolean }) {
  return (
    <div className={cx("flex h-[54px] items-end justify-between px-9 pb-2 text-[15px] font-semibold", dark ? "text-white" : "text-black")}>
      <span>9:41</span>
      <span className="flex items-center gap-1.5">
        <span className="flex items-end gap-[2px]">
          {[4, 6, 8, 10].map((h) => (
            <span key={h} className={cx("w-[3px] rounded-[1px]", dark ? "bg-white" : "bg-black")} style={{ height: h }} />
          ))}
        </span>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M1.5 4.2a9.5 9.5 0 0 1 13 0M4 7a5.8 5.8 0 0 1 8 0M6.5 9.7a2.2 2.2 0 0 1 3 0" />
        </svg>
        <span className={cx("relative h-[12px] w-[26px] rounded-[4px] border", dark ? "border-white/60" : "border-black/60")}>
          <span className={cx("absolute inset-[2px] right-[6px] rounded-[2px]", dark ? "bg-white" : "bg-black")} />
        </span>
      </span>
    </div>
  );
}

function TabBar({ dark, active }: { dark: boolean; active: "home" | "reels" }) {
  const c = dark ? "text-white" : "text-black";
  return (
    <div className={cx("absolute inset-x-0 bottom-0 flex h-[84px] items-start justify-around border-t px-4 pt-3", dark ? "border-white/10 bg-black" : "border-black/10 bg-white", c)}>
      <Home size={26} strokeWidth={active === "home" ? 2.6 : 1.8} />
      <Search size={26} strokeWidth={1.8} />
      <PlusSquare size={26} strokeWidth={1.8} />
      <Clapperboard size={26} strokeWidth={active === "reels" ? 2.6 : 1.8} />
      <span className="h-[26px] w-[26px] rounded-full bg-gradient-to-tr from-sys-orange to-sys-pink" />
      <span className={cx("absolute bottom-2 left-1/2 h-[5px] w-[140px] -translate-x-1/2 rounded-full", dark ? "bg-white" : "bg-black")} />
    </div>
  );
}

function Avatar({ size = 32 }: { size?: number }) {
  return (
    <span className="rounded-full bg-gradient-to-tr from-sys-yellow via-sys-pink to-sys-purple p-[2px]" style={{ width: size, height: size }}>
      <span className="flex h-full w-full items-center justify-center rounded-full bg-black text-[11px] font-bold text-white">R</span>
    </span>
  );
}

export function PhonePreview({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const format = getFormat(project.formatId);
  const isVertical = format.height / format.width > 1.3;
  const [view, setView] = useState<View>(isVertical ? "reels" : "feed");
  const [persona, setPersona] = useState<Persona>(() => loadPersona(`${project.name} · link in bio`));
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 72) / (SCREEN_H + BEZEL * 2), (window.innerWidth - 420) / (SCREEN_W + BEZEL * 2)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const savePersona = (patch: Partial<Persona>) => {
    const next = { ...persona, ...patch };
    setPersona(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // Instagram shows feed media at up to 4:5; anything taller is centre-cropped.
  const feedRatio = Math.min(format.height / format.width, 1.25);
  const feedH = Math.round(SCREEN_W * feedRatio);
  const dark = view === "reels";

  return (
    <div className="fixed inset-0 z-50 flex items-stretch bg-black/75 backdrop-blur-sm" role="dialog" aria-label="Phone preview" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="card m-4 flex w-80 shrink-0 flex-col gap-4 p-4" onPointerDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <Smartphone size={18} className="text-sys-blue" /> iPhone 16 Pro Max
          </p>
          <button type="button" className="rounded-md p-1 text-label-2 hover:bg-sys-gray4 hover:text-white" onClick={onClose} aria-label="Close phone preview">
            <X size={18} />
          </button>
        </div>
        <p className="text-[12px] leading-snug text-label-2">
          {SCREEN_W}×{SCREEN_H} pt screen, shown at {Math.round(scale * 100)}%. The picture mirrors the editor preview live, so press Play to watch it in place.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="pill justify-center" data-active={view === "feed" ? "true" : "false"} onClick={() => setView("feed")}>
            Feed post
          </button>
          <button type="button" className="pill justify-center" data-active={view === "reels" ? "true" : "false"} onClick={() => setView("reels")}>
            Reel
          </button>
        </div>
        {view === "feed" && format.height / format.width > 1.25 && (
          <p className="rounded-lg border border-sys-orange/40 bg-sys-orange/10 p-2 text-[12px] leading-snug text-sys-orange">
            This {format.ratio} format is taller than a feed post: Instagram crops it to 4:5 in the feed (shown here). Use the Instagram Post (4:5) format or post it as a Reel.
          </p>
        )}
        <label className="block">
          <span className="caps">Username</span>
          <input className="mt-1.5 h-9 w-full rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 text-[13px] text-white focus:border-sys-blue focus:outline-none" value={persona.username} onChange={(e) => savePersona({ username: e.target.value.replace(/\s+/g, "") })} />
        </label>
        <label className="block">
          <span className="caps">Caption</span>
          <textarea className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-1.5 text-[13px] leading-snug text-white focus:border-sys-blue focus:outline-none" value={persona.caption} onChange={(e) => savePersona({ caption: e.target.value })} />
        </label>
        <p className="text-[11px] text-label-3">Only the first two lines show before “more”. Links in captions are not clickable on Instagram; keep “link in bio”.</p>
      </aside>

      <div className="flex flex-1 items-center justify-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ width: (SCREEN_W + BEZEL * 2) * scale, height: (SCREEN_H + BEZEL * 2) * scale }}>
          <div className="origin-top-left rounded-[68px] bg-[#1d1d1f] shadow-[0_40px_120px_rgba(0,0,0,0.7),inset_0_0_0_2px_#3a3a3c]" style={{ width: SCREEN_W + BEZEL * 2, height: SCREEN_H + BEZEL * 2, padding: BEZEL, transform: `scale(${scale})` }} onPointerDown={(e) => e.stopPropagation()}>
            <div className={cx("relative overflow-hidden rounded-[56px]", dark ? "bg-black text-white" : "bg-white text-black")} style={{ width: SCREEN_W, height: SCREEN_H, fontFamily: "-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif" }} data-phone-screen>
              {/* Dynamic Island */}
              <div className="absolute left-1/2 top-[11px] z-20 h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" />

              {view === "feed" ? (
                <>
                  <StatusBar dark={false} />
                  <div className="flex h-11 items-center justify-between px-4">
                    <span className="text-[26px] font-semibold tracking-tight" style={{ fontFamily: "'Brush Script MT', 'Snell Roundhand', cursive" }}>
                      Instagram
                    </span>
                    <span className="flex items-center gap-5">
                      <Heart size={26} strokeWidth={1.8} />
                      <Send size={24} strokeWidth={1.8} className="-rotate-12" />
                    </span>
                  </div>
                  <div className="flex h-12 items-center gap-2.5 px-3">
                    <Avatar />
                    <span className="flex-1 text-[14px] font-semibold">{persona.username || "username"}</span>
                    <MoreHorizontal size={20} />
                  </div>
                  <MediaMirror width={SCREEN_W} height={feedH} className="block bg-black" />
                  <div className="flex h-12 items-center gap-4 px-3">
                    <Heart size={26} strokeWidth={1.8} />
                    <MessageCircle size={26} strokeWidth={1.8} className="-scale-x-100" />
                    <Send size={24} strokeWidth={1.8} className="-rotate-12" />
                    <Bookmark size={26} strokeWidth={1.8} className="ml-auto" />
                  </div>
                  <div className="space-y-1 px-3 text-[14px] leading-snug">
                    <p className="font-semibold">1,204 likes</p>
                    <p className="line-clamp-2">
                      <span className="font-semibold">{persona.username || "username"}</span> {persona.caption}
                      <span className="text-black/50"> more</span>
                    </p>
                    <p className="text-black/50">View all 32 comments</p>
                    <p className="text-[12px] text-black/50">2 hours ago</p>
                  </div>
                  <TabBar dark={false} active="home" />
                </>
              ) : (
                <>
                  <MediaMirror width={SCREEN_W} height={SCREEN_H - 84} className="absolute left-0 top-0 block bg-black" />
                  <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/50 to-transparent" />
                  <div className="absolute inset-x-0 bottom-[84px] h-72 bg-gradient-to-t from-black/70 to-transparent" />
                  <StatusBar dark />
                  <div className="absolute left-4 top-[58px] flex items-center gap-4 text-[22px] font-bold text-white">Reels</div>
                  <div className="absolute right-3 top-[60px] text-white">
                    <Search size={26} strokeWidth={1.8} />
                  </div>
                  <div className="absolute bottom-[104px] right-3 flex flex-col items-center gap-5 text-white">
                    <span className="flex flex-col items-center gap-1 text-[12px] font-semibold">
                      <Heart size={28} strokeWidth={1.8} />
                      12.4K
                    </span>
                    <span className="flex flex-col items-center gap-1 text-[12px] font-semibold">
                      <MessageCircle size={28} strokeWidth={1.8} className="-scale-x-100" />
                      248
                    </span>
                    <span className="flex flex-col items-center gap-1 text-[12px] font-semibold">
                      <Send size={26} strokeWidth={1.8} className="-rotate-12" />
                      1,102
                    </span>
                    <MoreHorizontal size={26} />
                    <span className="h-7 w-7 rounded-md border-2 border-white bg-sys-gray4" />
                  </div>
                  <div className="absolute bottom-[104px] left-4 right-20 space-y-2.5 text-white">
                    <p className="flex items-center gap-2.5 text-[14px] font-semibold">
                      <Avatar size={30} /> {persona.username || "username"} <span className="rounded-md border border-white/70 px-2 py-0.5 text-[12px] font-semibold">Follow</span>
                    </p>
                    <p className="line-clamp-2 text-[14px] leading-snug">
                      {persona.caption}
                      <span className="text-white/60"> more</span>
                    </p>
                    <p className="flex items-center gap-2 text-[13px]">
                      <Music size={14} /> {project.music ? project.music.name : `${persona.username || "username"} · Original audio`}
                    </p>
                  </div>
                  <TabBar dark active="reels" />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
