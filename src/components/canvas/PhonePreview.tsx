"use client";
/**
 * Phone preview: the live composition inside a phone mock-up (iPhones,
 * Galaxies and Pixels at their real screen sizes and cutouts) showing how the post reads in the
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
import { Select } from "@/components/ui/Select";

/**
 * Phones to preview on. Screen sizes are the logical viewport (iOS points,
 * Android dp) the Instagram app lays out in; cutouts, corner radii and bar
 * heights follow each phone closely enough to judge what gets covered.
 */
export interface PhoneDevice {
  id: string;
  name: string;
  brand: "Apple" | "Samsung" | "Google";
  os: "ios" | "android";
  w: number;
  h: number;
  /** Screen corner radius. */
  radius: number;
  bezel: number;
  cutout: "island" | "notch" | "punch";
  /** Status bar height (top of the screen to the app's first row). */
  statusH: number;
  /** Bottom tab bar height including the home indicator / gesture bar. */
  tabH: number;
}

export const PHONE_DEVICES: PhoneDevice[] = [
  { id: "iphone-16-pro-max", name: "iPhone 16 Pro Max", brand: "Apple", os: "ios", w: 440, h: 956, radius: 56, bezel: 14, cutout: "island", statusH: 54, tabH: 84 },
  { id: "iphone-16-pro", name: "iPhone 16 Pro", brand: "Apple", os: "ios", w: 402, h: 874, radius: 54, bezel: 13, cutout: "island", statusH: 54, tabH: 84 },
  { id: "iphone-16-plus", name: "iPhone 16 Plus", brand: "Apple", os: "ios", w: 430, h: 932, radius: 54, bezel: 15, cutout: "island", statusH: 54, tabH: 84 },
  { id: "iphone-16", name: "iPhone 16", brand: "Apple", os: "ios", w: 393, h: 852, radius: 52, bezel: 15, cutout: "island", statusH: 54, tabH: 84 },
  { id: "iphone-13-mini", name: "iPhone 13 mini", brand: "Apple", os: "ios", w: 375, h: 812, radius: 44, bezel: 15, cutout: "notch", statusH: 50, tabH: 83 },
  { id: "galaxy-s24-ultra", name: "Galaxy S24 Ultra", brand: "Samsung", os: "android", w: 384, h: 832, radius: 14, bezel: 9, cutout: "punch", statusH: 36, tabH: 70 },
  { id: "galaxy-s24", name: "Galaxy S24", brand: "Samsung", os: "android", w: 360, h: 780, radius: 34, bezel: 10, cutout: "punch", statusH: 36, tabH: 70 },
  { id: "pixel-9", name: "Pixel 9", brand: "Google", os: "android", w: 412, h: 923, radius: 40, bezel: 12, cutout: "punch", statusH: 40, tabH: 72 },
];
const DEVICE_KEY = "reelflow.phoneDevice";
const DEFAULT_DEVICE = PHONE_DEVICES[0];

export function getPhoneDevice(id: string | null | undefined): PhoneDevice {
  return PHONE_DEVICES.find((d) => d.id === id) ?? DEFAULT_DEVICE;
}

function loadDevice(): PhoneDevice {
  try {
    return getPhoneDevice(localStorage.getItem(DEVICE_KEY));
  } catch {
    return DEFAULT_DEVICE;
  }
}

const STORAGE_KEY = "reelflow.phonePreview";

type View = "feed" | "reels";

interface Persona {
  username: string;
  caption: string;
  /** Profile photo as a small data URL, kept in this browser only. */
  avatar: string | null;
}

const DEFAULT_USERNAME = "yourhandle";

function loadPersona(fallbackCaption: string): Persona {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Persona>;
      return { username: DEFAULT_USERNAME, caption: fallbackCaption, avatar: null, ...saved };
    }
  } catch {
    /* ignore */
  }
  return { username: DEFAULT_USERNAME, caption: fallbackCaption, avatar: null };
}

/** Squares and shrinks a picked photo to 160 px so it fits in localStorage. */
async function avatarDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = new OffscreenCanvas(160, 160);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 160, 160);
  bmp.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new Promise((resolve) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.readAsDataURL(blob);
  });
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

function StatusBar({ dark, device }: { dark: boolean; device: PhoneDevice }) {
  const ios = device.os === "ios";
  return (
    <div className={cx("flex justify-between font-semibold", ios ? "items-end px-9 pb-2 text-[15px]" : "items-center px-5 text-[13px] font-medium", dark ? "text-white" : "text-black")} style={{ height: device.statusH }}>
      <span>{ios ? "9:41" : "12:30"}</span>
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

function TabBar({ dark, active, avatar, device }: { dark: boolean; active: "home" | "reels"; avatar: string | null; device: PhoneDevice }) {
  const c = dark ? "text-white" : "text-black";
  return (
    <div className={cx("absolute inset-x-0 bottom-0 flex items-start justify-around border-t px-4 pt-3", dark ? "border-white/10 bg-black" : "border-black/10 bg-white", c)} style={{ height: device.tabH }}>
      <Home size={26} strokeWidth={active === "home" ? 2.6 : 1.8} />
      <Search size={26} strokeWidth={1.8} />
      <PlusSquare size={26} strokeWidth={1.8} />
      <Clapperboard size={26} strokeWidth={active === "reels" ? 2.6 : 1.8} />
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="h-[26px] w-[26px] rounded-full object-cover" />
      ) : (
        <span className="h-[26px] w-[26px] rounded-full bg-gradient-to-tr from-sys-orange to-sys-pink" />
      )}
      {/* Home indicator on iPhone, gesture bar on Android. */}
      <span className={cx("absolute left-1/2 -translate-x-1/2 rounded-full", device.os === "ios" ? "bottom-2 h-[5px] w-[140px]" : "bottom-[7px] h-[4px] w-[108px] opacity-80", dark ? "bg-white" : "bg-black")} />
    </div>
  );
}

function Avatar({ size = 32, src, initial }: { size?: number; src: string | null; initial: string }) {
  return (
    <span className="shrink-0 rounded-full bg-gradient-to-tr from-sys-yellow via-sys-pink to-sys-purple p-[2px]" style={{ width: size, height: size }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="h-full w-full rounded-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center rounded-full bg-black text-[11px] font-bold uppercase text-white">{initial}</span>
      )}
    </span>
  );
}

export function PhonePreview({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const format = getFormat(project.formatId);
  const isVertical = format.height / format.width > 1.3;
  const [view, setView] = useState<View>(isVertical ? "reels" : "feed");
  const [persona, setPersona] = useState<Persona>(() => loadPersona(`${project.name} · link in bio`));
  const [device, setDevice] = useState<PhoneDevice>(loadDevice);
  const { w: SCREEN_W, h: SCREEN_H, bezel: BEZEL } = device;
  const pickDevice = (id: string) => {
    const d = getPhoneDevice(id);
    setDevice(d);
    try {
      localStorage.setItem(DEVICE_KEY, d.id);
    } catch {
      /* ignore */
    }
  };
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 72) / (SCREEN_H + BEZEL * 2), (window.innerWidth - 420) / (SCREEN_W + BEZEL * 2)));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [SCREEN_W, SCREEN_H, BEZEL]);
  const brands = [...new Set(PHONE_DEVICES.map((d) => d.brand))];
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
            <Smartphone size={18} className="text-sys-blue" /> {device.name}
          </p>
          <button type="button" className="rounded-md p-1 text-label-2 hover:bg-sys-gray4 hover:text-white" onClick={onClose} aria-label="Close phone preview">
            <X size={18} />
          </button>
        </div>
        <label className="block">
          <span className="caps">Phone</span>
          <Select className="mt-1.5" value={device.id} onChange={(e) => pickDevice(e.target.value)} aria-label="Phone model">
            {brands.map((b) => (
              <optgroup key={b} label={b}>
                {PHONE_DEVICES.filter((d) => d.brand === b).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </label>
        <p className="text-[12px] leading-snug text-label-2" data-phone-size>
          {SCREEN_W}×{SCREEN_H} {device.os === "ios" ? "pt" : "dp"} screen, shown at {Math.round(scale * 100)}%. The picture mirrors the editor preview live, so press Play to watch it in place.
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
        <div className="flex items-center gap-3">
          <Avatar size={48} src={persona.avatar} initial={(persona.username || "i").slice(0, 1)} />
          <div className="flex flex-col gap-1">
            <label className="cursor-pointer text-[12px] text-sys-blue hover:underline">
              {persona.avatar ? "Change profile photo" : "Add profile photo"}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) savePersona({ avatar: await avatarDataUrl(f) });
                }}
              />
            </label>
            {persona.avatar && (
              <button type="button" className="text-left text-[12px] text-label-3 hover:text-white" onClick={() => savePersona({ avatar: null })}>
                Remove photo
              </button>
            )}
          </div>
        </div>
        <label className="block">
          <span className="caps">Username</span>
          <input className="mt-1.5 h-9 w-full rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 text-[13px] text-white focus:border-sys-blue focus:outline-none" value={persona.username} onChange={(e) => savePersona({ username: e.target.value.replace(/\s+/g, "") })} />
        </label>
        <label className="block">
          <span className="caps">Caption</span>
          <textarea className="mt-1.5 min-h-24 w-full resize-y rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-1.5 text-[13px] leading-snug text-white focus:border-sys-blue focus:outline-none" value={persona.caption} onChange={(e) => savePersona({ caption: e.target.value })} />
        </label>
        <p className="text-[11px] text-label-3">Only the first two lines show before “more”. Links in captions are not clickable on Instagram; keep “link in bio”.</p>
          <p className="text-[11px] text-label-3">This is a mock-up of the Instagram app, not a login: the username and photo stay in this browser and nothing is sent to Instagram.</p>
      </aside>

      <div className="flex flex-1 items-center justify-center" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
        <div style={{ width: (SCREEN_W + BEZEL * 2) * scale, height: (SCREEN_H + BEZEL * 2) * scale }}>
          <div className="origin-top-left bg-[#1d1d1f] shadow-[0_40px_120px_rgba(0,0,0,0.7),inset_0_0_0_2px_#3a3a3c]" style={{ width: SCREEN_W + BEZEL * 2, height: SCREEN_H + BEZEL * 2, padding: BEZEL, borderRadius: device.radius + BEZEL, transform: `scale(${scale})` }} onPointerDown={(e) => e.stopPropagation()}>
            <div
              className={cx("relative overflow-hidden", dark ? "bg-black text-white" : "bg-white text-black")}
              style={{ width: SCREEN_W, height: SCREEN_H, borderRadius: device.radius, fontFamily: device.os === "ios" ? "-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif" : "Roboto, 'Google Sans', 'Segoe UI', system-ui, sans-serif" }}
              data-phone-screen
              data-device={device.id}
            >
              {device.cutout === "island" && <div className="absolute left-1/2 top-[11px] z-20 h-[37px] w-[126px] -translate-x-1/2 rounded-full bg-black" data-cutout="island" />}
              {device.cutout === "notch" && <div className="absolute left-1/2 top-0 z-20 h-[32px] w-[162px] -translate-x-1/2 rounded-b-[20px] bg-black" data-cutout="notch" />}
              {device.cutout === "punch" && <div className="absolute left-1/2 z-20 h-[13px] w-[13px] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10" style={{ top: Math.round(device.statusH / 2 - 6.5) }} data-cutout="punch" />}

              {view === "feed" ? (
                <>
                  <StatusBar dark={false} device={device} />
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
                    <Avatar src={persona.avatar} initial={(persona.username || "i").slice(0, 1)} />
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
                  <TabBar dark={false} active="home" avatar={persona.avatar} device={device} />
                </>
              ) : (
                <>
                  <MediaMirror width={SCREEN_W} height={SCREEN_H - device.tabH} className="absolute left-0 top-0 block bg-black" />
                  <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/50 to-transparent" />
                  <div className="absolute inset-x-0 h-72 bg-gradient-to-t from-black/70 to-transparent" style={{ bottom: device.tabH }} />
                  <StatusBar dark device={device} />
                  <div className="absolute left-4 flex items-center gap-4 text-[22px] font-bold text-white" style={{ top: device.statusH + 4 }}>Reels</div>
                  <div className="absolute right-3 text-white" style={{ top: device.statusH + 6 }}>
                    <Search size={26} strokeWidth={1.8} />
                  </div>
                  <div className="absolute right-3 flex flex-col items-center gap-5 text-white" style={{ bottom: device.tabH + 20 }}>
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
                  <div className="absolute left-4 right-20 space-y-2.5 text-white" style={{ bottom: device.tabH + 20 }}>
                    <p className="flex items-center gap-2.5 text-[14px] font-semibold">
                      <Avatar size={30} src={persona.avatar} initial={(persona.username || "i").slice(0, 1)} /> {persona.username || "username"} <span className="rounded-md border border-white/70 px-2 py-0.5 text-[12px] font-semibold">Follow</span>
                    </p>
                    <p className="line-clamp-2 text-[14px] leading-snug">
                      {persona.caption}
                      <span className="text-white/60"> more</span>
                    </p>
                    <p className="flex items-center gap-2 text-[13px]">
                      <Music size={14} /> {project.music ? project.music.name : `${persona.username || "username"} · Original audio`}
                    </p>
                  </div>
                  <TabBar dark active="reels" avatar={persona.avatar} device={device} />
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
