"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, GripVertical, House, LayoutGrid, Smartphone, X } from "lucide-react";
import { emulatorIsOff } from "@/lib/phone/emulatorStart";
import { AnnexBSplitter, FrameAssembler } from "@/lib/phone/h264";
import { phoneBridge, toPhonePoint, type PhoneInfo } from "@/lib/phone/phoneBridge";
import { clampPanelWidth, loadPanelWidth, PANEL_DEFAULT_WIDTH, pictureSize, savePanelWidth } from "@/lib/phone/panelSize";
import { usePhone } from "@/lib/phone/phoneStore";
import { EmulatorStart } from "./EmulatorStart";

/** Id of the element in the top bar that holds the phone button. */
export const PHONE_BUTTON_SLOT = "editor-phone-button-slot";

const ICON = "rounded p-0.5 text-label-3 hover:bg-sys-gray4 hover:text-white";
/** A labelled button under the phone: an icon with its name beneath, so nobody has to guess. */
const NAV = "flex flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] leading-tight text-label-2 hover:bg-sys-gray4 hover:text-white disabled:opacity-50";
const KEY = { home: 3, back: 4, enter: 66, del: 67, tab: 61, up: 19, down: 20, left: 21, right: 22, recents: 187 } as const;
/** A press that travels less than this (in drawn pixels) is a tap, more is a swipe. */
const TAP_SLOP = 8;
/** The stream has gone quiet for this long: the frame being received is complete. */
const QUIET_MS = 40;

const noSubscription = () => () => undefined;
const findSlot = () => document.getElementById(PHONE_BUTTON_SLOT);
const hasPhone = () => phoneBridge() !== null;

/**
 * The Android emulator's screen, live, in a column beside the preview (desktop app only).
 * Click to tap, drag to swipe, type to type. The top bar button opens and closes it.
 */
export function PhonePanel() {
  const open = usePhone((s) => s.open);
  const setOpen = usePhone((s) => s.setOpen);
  const desktop = useSyncExternalStore(noSubscription, hasPhone, () => false);
  const slot = useSyncExternalStore(noSubscription, findSlot, () => null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [live, setLive] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [round, setRound] = useState(0);
  const phoneRound = usePhone((s) => s.phoneRound);
  // Until the user drags the handle on its left edge the phone is as large as the column's height allows
  // (null). A dragged width is theirs, and can only be smaller than that.
  const [width, setWidth] = useState<number | null>(() => loadPanelWidth());
  const asideRef = useRef<HTMLElement>(null);
  /** The height of the column the panel sits in, which sets how large the phone can be. */
  const [room, setRoom] = useState<{ height: number; windowWidth: number } | null>(null);
  const dragRef = useRef<{ x: number; width: number } | null>(null);
  const pressRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const typedRef = useRef<{ text: string; timer: ReturnType<typeof setTimeout> | null }>({ text: "", timer: null });

  // The live picture: the shell streams the phone's screen as H.264, decoded here onto the canvas.
  useEffect(() => {
    if (!open) return;
    const api = phoneBridge();
    if (!api) return;
    let stopped = false;
    let decoder: VideoDecoder | null = null;
    let configured = "";
    let waitingForKey = true;
    let quiet: ReturnType<typeof setTimeout> | null = null;
    const splitter = new AnnexBSplitter();
    const frames = new FrameAssembler();

    const restart = () => {
      if (stopped) return;
      setLive(false);
      setRound((r) => r + 1);
    };
    const paint = (frame: VideoFrame) => {
      const canvas = canvasRef.current;
      if (canvas && !stopped) {
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        canvas.getContext("2d")?.drawImage(frame, 0, 0);
        setLive(true);
      }
      frame.close();
    };
    const feed = (units: Uint8Array[]) => {
      for (const unit of units) {
        const f = frames.add(unit);
        if (!f) continue;
        if (f.key && f.codec && f.codec !== configured) {
          decoder?.close();
          decoder = new VideoDecoder({ output: paint, error: restart });
          decoder.configure({ codec: f.codec, optimizeForLatency: true });
          configured = f.codec;
          waitingForKey = true;
        }
        if (!decoder || decoder.state !== "configured") continue;
        if (waitingForKey && !f.key) continue;
        waitingForKey = false;
        try {
          decoder.decode(new EncodedVideoChunk({ type: f.key ? "key" : "delta", timestamp: Math.round(performance.now() * 1000), data: f.data }));
        } catch {
          restart();
          return;
        }
      }
    };

    api.onVideo((chunk) => {
      if (stopped) return;
      if (quiet) clearTimeout(quiet);
      if (chunk === null) {
        // The phone's recorder started over: a fresh stream follows.
        splitter.reset();
        frames.reset();
        configured = "";
        return;
      }
      feed(splitter.push(chunk));
      quiet = setTimeout(() => feed(splitter.flush()), QUIET_MS);
    });

    void (async () => {
      try {
        const now = await api.info();
        if (stopped) return;
        setInfo(now);
        if (!now.available) return;
        await api.screen(true);
      } catch (e) {
        if (!stopped) setInfo({ available: false, reason: e instanceof Error ? e.message : "The emulator did not answer." });
      }
    })();

    return () => {
      stopped = true;
      if (quiet) clearTimeout(quiet);
      api.onVideo(null);
      void api.screen(false).catch(() => undefined);
      try {
        decoder?.close();
      } catch {
        /* already closed */
      }
    };
  }, [open, round, phoneRound]);

  useEffect(() => {
    if (!open) return;
    const el = asideRef.current;
    if (!el) return;
    const measure = () => setRoom({ height: el.getBoundingClientRect().height, windowWidth: window.innerWidth });
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  const send = (action: Parameters<NonNullable<ReturnType<typeof phoneBridge>>["input"]>[0]) => {
    const api = phoneBridge();
    if (!api) return;
    void api
      .input(action)
      .then((r) => setNote(r.dropped?.length ? `The phone cannot type: ${r.dropped.join(" ")}` : null))
      .catch((e: unknown) => setNote(e instanceof Error ? e.message : "The emulator did not answer."));
  };

  const [goingHome, setGoingHome] = useState(false);
  /** Instagram's home feed. With an editor or a draft open nothing is pressed, and the note says how to leave it. */
  const instagramHome = () => {
    const api = phoneBridge();
    if (!api || goingHome) return;
    setGoingHome(true);
    setNote(null);
    void api
      .instagramHome()
      .then((r) => setNote(r.state === "busy" ? "Instagram has an editor or a draft open, so nothing was pressed. Leave it with the arrow or X at the top left of the phone screen (Instagram asks before it discards a draft), then press Instagram again." : null))
      .catch((e: unknown) => setNote(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The emulator did not answer."))
      .finally(() => setGoingHome(false));
  };

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, width: r.width, height: r.height };
  };
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    pressRef.current = { x: p.x, y: p.y, at: performance.now() };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const from = pressRef.current;
    pressRef.current = null;
    if (!from || !info?.width || !info.height) return;
    const p = point(e);
    const phone = { width: info.width, height: info.height };
    const a = toPhonePoint(from.x, from.y, p, phone);
    const b = toPhonePoint(p.x, p.y, p, phone);
    if (Math.hypot(p.x - from.x, p.y - from.y) < TAP_SLOP) send({ kind: "tap", x: a.x, y: a.y });
    else send({ kind: "swipe", x1: a.x, y1: a.y, x2: b.x, y2: b.y, ms: Math.round(performance.now() - from.at) });
  };

  // Typed letters are gathered for a moment and sent together: each send takes the phone a while.
  const typeSoon = (text: string) => {
    const t = typedRef.current;
    t.text += text;
    if (t.timer) clearTimeout(t.timer);
    t.timer = setTimeout(() => {
      const all = t.text;
      t.text = "";
      t.timer = null;
      if (all) send({ kind: "text", text: all });
    }, 350);
  };
  const flushTyped = () => {
    const t = typedRef.current;
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    const all = t.text;
    t.text = "";
    if (all) send({ kind: "text", text: all });
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (e.metaKey || e.ctrlKey) return; // leaves ⌘V (paste, below) and the app's own shortcuts alone
    const named: Record<string, number> = { Enter: KEY.enter, Backspace: KEY.del, Tab: KEY.tab, ArrowUp: KEY.up, ArrowDown: KEY.down, ArrowLeft: KEY.left, ArrowRight: KEY.right, Escape: KEY.back };
    if (e.key in named) {
      e.preventDefault();
      e.stopPropagation();
      flushTyped();
      send({ kind: "key", code: named[e.key] });
    } else if (e.key.length === 1) {
      e.preventDefault();
      e.stopPropagation();
      typeSoon(e.key);
    }
  };
  const onPaste = (e: React.ClipboardEvent<HTMLCanvasElement>) => {
    const text = e.clipboardData.getData("text");
    if (!text) return;
    e.preventDefault();
    flushTyped();
    send({ kind: "text", text });
  };

  if (!desktop) return null;
  const phoneSize = { width: info?.width ?? 1080, height: info?.height ?? 2424 };
  // No dragged width: as wide as the full-height picture needs. A dragged one is held to that at most.
  const shown = room ? clampPanelWidth(width ?? Number.MAX_SAFE_INTEGER, room, phoneSize) : (width ?? PANEL_DEFAULT_WIDTH);
  const resizeTo = (next: number | null) => {
    const w = next === null ? null : room ? clampPanelWidth(next, room, phoneSize) : next;
    // Dragged back out to the largest size: that is the default again, so it keeps following the window.
    const largest = room ? clampPanelWidth(Number.MAX_SAFE_INTEGER, room, phoneSize) : null;
    const keep = w !== null && largest !== null && w >= largest ? null : w;
    setWidth(keep);
    savePanelWidth(keep);
  };
  /** The picture's size in the phone's own shape, so a narrower panel shrinks it instead of squashing it. */
  const picture = room ? pictureSize({ width: shown, height: room.height }, phoneSize) : null;
  const ratio = info?.width && info.height ? `${info.width} / ${info.height}` : "9 / 20";

  return (
    <>
      {slot &&
        createPortal(
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className={`card flex h-[38px] w-[38px] shrink-0 items-center justify-center hover:text-white ${open ? "text-sys-blue" : "text-label-2"}`}
            aria-label="Phone"
            aria-pressed={open}
            title={open ? "Hide the phone" : "Show the Android emulator"}
            data-phone-toggle
          >
            <Smartphone size={18} />
          </button>,
          slot,
        )}
      {open && (
        <aside ref={asideRef} className="relative min-h-0 shrink-0" style={{ width: shown }} data-phone-panel>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the phone"
            tabIndex={0}
            title="Drag to make the phone smaller or larger. Double-click for full size."
            className="absolute -left-2.5 top-1/2 z-50 flex h-12 w-4 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-md border border-sys-gray4 bg-sys-gray5 text-label-2 hover:bg-sys-gray4 hover:text-white"
            onPointerDown={(e) => {
              dragRef.current = { x: e.clientX, width: shown };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (d) resizeTo(d.width + (d.x - e.clientX));
            }}
            onPointerUp={() => (dragRef.current = null)}
            onPointerCancel={() => (dragRef.current = null)}
            onDoubleClick={() => resizeTo(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") resizeTo(shown + 24);
              else if (e.key === "ArrowRight") resizeTo(shown - 24);
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
            data-phone-resize
          >
            <GripVertical size={14} aria-hidden />
          </div>
          <section
            className="flex h-full min-h-0 flex-col rounded-xl border border-sys-gray4 bg-sys-gray5/40"
            aria-label="Phone"
          >
            <h4 className="flex items-center gap-2 border-b border-sys-gray4 px-3 py-2 text-[13px] font-semibold text-white">
              <Smartphone size={15} aria-hidden /> Phone
              {live && (
                <span className="text-[11px] font-normal text-sys-green" data-phone-live>
                  Live
                </span>
              )}
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => setOpen(false)} className={ICON} aria-label="Hide the phone" title="Hide the phone" data-phone-close>
                  <X size={15} />
                </button>
              </span>
            </h4>
            <div className="relative flex min-h-0 flex-1 items-center justify-center p-2">
              {info && !info.available && info.emulator && emulatorIsOff(info) ? (
                <div className="w-full max-w-[22rem]" data-phone-missing>
                  <EmulatorStart info={info} onCheck={() => setRound((r) => r + 1)} />
                </div>
              ) : info && !info.available ? (
                <p className="rf-read-note px-3 text-center" data-phone-missing>
                  {info.reason ?? "Start the Android emulator first."}{" "}
                  <button type="button" className="underline hover:text-white" onClick={() => setRound((r) => r + 1)}>
                    Try again
                  </button>
                </p>
              ) : (
                <canvas
                  ref={canvasRef}
                  tabIndex={0}
                  className="max-h-full max-w-full cursor-pointer touch-none rounded-lg border border-sys-gray4 bg-black outline-none focus:border-sys-blue"
                  style={picture ? { width: picture.width, height: picture.height } : { aspectRatio: ratio, height: "100%" }}
                  onPointerDown={onPointerDown}
                  onPointerUp={onPointerUp}
                  onKeyDown={onKeyDown}
                  onPaste={onPaste}
                  aria-label="The phone's screen. Click to tap, drag to swipe, type to type."
                  data-phone-screen
                />
              )}
              {/* Laid over the picture's lower edge, so a message never changes the picture's size. */}
              {note && (
                <button type="button" onClick={() => setNote(null)} className="rf-read-note absolute inset-x-3 bottom-3 rounded-lg border border-sys-gray4 px-2.5 py-1.5 text-left" style={{ background: "var(--color-sys-gray6)" }} title="Click to hide" data-phone-note>
                  {note}
                </button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1 border-t border-sys-gray4 p-1.5">
              <button type="button" className={NAV} onClick={() => send({ kind: "key", code: KEY.back })} title="Go back one screen, like the phone's Back button" data-phone-back>
                <ArrowLeft size={16} aria-hidden />
                Back
              </button>
              <button type="button" className={NAV} onClick={() => send({ kind: "key", code: KEY.home })} title="The phone's own home screen, with all its apps" data-phone-home>
                <Smartphone size={16} aria-hidden />
                Phone home
              </button>
              <button type="button" className={NAV} onClick={() => send({ kind: "key", code: KEY.recents })} title="The apps that are open, to switch between them" data-phone-recents>
                <LayoutGrid size={16} aria-hidden />
                Open apps
              </button>
              <button type="button" className={`${NAV} text-white`} onClick={instagramHome} disabled={goingHome} title="Open Instagram on its home feed" data-phone-instagram>
                <House size={16} aria-hidden />
                {goingHome ? "Opening" : "Instagram"}
              </button>
            </div>
          </section>
        </aside>
      )}
    </>
  );
}
