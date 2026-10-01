"use client";
/**
 * Frame-format picker, laid out like VEED's: a pill that opens a searchable
 * list grouped by platform, each row with a platform badge, the name and the
 * ratio in grey, a check on the current one, and the safe-zone overlay
 * switch at the foot. Keyboard: type to search, arrows to move, Enter to
 * pick, Escape to close.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Ghost, Music2, Play, AtSign, Eye } from "lucide-react";
import { FRAME_FORMATS, getFormat, type FrameFormat } from "@/lib/models/formats";
import { useEditor } from "@/store/editorStore";
import { cx } from "@/lib/utils/cx";

/** A small square badge per platform; generic sizes draw their own aspect. */
export function PlatformBadge({ format, size = 22 }: { format: FrameFormat; size?: number }) {
  const box = "flex shrink-0 items-center justify-center rounded-[6px] font-bold leading-none";
  const s = { width: size, height: size, fontSize: Math.round(size * 0.5) };
  const icon = Math.round(size * 0.6);
  switch (format.platform) {
    case "Instagram":
      return (
        <span className={cx(box, "text-white")} style={{ ...s, background: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fd5949 45%, #d6249f 60%, #285AEB 90%)" }} aria-hidden>
          <span className="block rounded-[4px] border-2 border-white" style={{ width: size * 0.56, height: size * 0.56, position: "relative" }}>
            <span className="absolute left-1/2 top-1/2 block -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white" style={{ width: size * 0.24, height: size * 0.24 }} />
          </span>
        </span>
      );
    case "TikTok":
      return (
        <span className={cx(box, "bg-black text-white ring-1 ring-white/15")} style={s} aria-hidden>
          <Music2 size={icon} strokeWidth={2.5} style={{ filter: "drop-shadow(-1px -1px 0 #25F4EE) drop-shadow(1px 1px 0 #FE2C55)" }} />
        </span>
      );
    case "YouTube":
      return (
        <span className={cx(box, "bg-[#ff0033] text-white")} style={s} aria-hidden>
          <Play size={icon} fill="currentColor" strokeWidth={0} />
        </span>
      );
    case "Facebook":
      return (
        <span className={cx(box, "rounded-full bg-[#0866ff] text-white")} style={{ ...s, fontSize: Math.round(size * 0.68), paddingTop: size * 0.12 }} aria-hidden>
          f
        </span>
      );
    case "Snapchat":
      return (
        <span className={cx(box, "bg-[#fffc00] text-black")} style={s} aria-hidden>
          <Ghost size={icon} strokeWidth={2.4} />
        </span>
      );
    case "Pinterest":
      return (
        <span className={cx(box, "rounded-full bg-[#e60023] text-white")} style={s} aria-hidden>
          P
        </span>
      );
    case "LinkedIn":
      return (
        <span className={cx(box, "bg-[#0a66c2] text-white")} style={{ ...s, fontSize: Math.round(size * 0.46) }} aria-hidden>
          in
        </span>
      );
    case "X":
      return (
        <span className={cx(box, "bg-black text-white ring-1 ring-white/15")} style={s} aria-hidden>
          X
        </span>
      );
    case "Threads":
      return (
        <span className={cx(box, "bg-black text-white ring-1 ring-white/15")} style={s} aria-hidden>
          <AtSign size={icon} strokeWidth={2.5} />
        </span>
      );
    default: {
      // Generic sizes: an outline in the format's own proportions.
      const k = (size * 0.72) / Math.max(format.width, format.height);
      return (
        <span className={box} style={s} aria-hidden>
          <span className="block rounded-[3px] border-2 border-label-2" style={{ width: format.width * k, height: format.height * k }} />
        </span>
      );
    }
  }
}

/** The name without a ratio it would repeat: "Instagram Post (4:5)" → "Instagram Post", "Vertical 9:16" → "Vertical", "(Square)" → "Square". */
export function displayName(f: FrameFormat): string {
  return f.name
    .replace(` (${f.ratio})`, "")
    .replace(new RegExp(` ${f.ratio.replace(":", "\\:")}$`), "")
    .replace(/ \((.+)\)$/, " $1");
}

/** Formats whose name, platform or ratio contains every word of the query. */
export function filterFormats(query: string, formats: FrameFormat[] = FRAME_FORMATS): FrameFormat[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return formats;
  return formats.filter((f) => {
    const hay = `${f.name} ${f.platform} ${f.ratio}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function FormatPicker() {
  const project = useEditor((s) => s.project)!;
  const update = useEditor((s) => s.update);
  const format = getFormat(project.formatId);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const safeOn = project.safeZone !== "none";

  const results = useMemo(() => filterFormats(query), [query]);
  const groups = useMemo(() => {
    const out: { platform: string; items: { f: FrameFormat; i: number }[] }[] = [];
    results.forEach((f, i) => {
      const g = out.find((x) => x.platform === f.platform) ?? (out.push({ platform: f.platform, items: [] }), out[out.length - 1]);
      g.items.push({ f, i });
    });
    return out;
  }, [results]);

  const openPicker = () => {
    setQuery("");
    setActive(Math.max(0, FRAME_FORMATS.findIndex((f) => f.id === project.formatId)));
    setOpen(true);
  };
  const choose = (f: FrameFormat) => {
    update((p) => {
      p.formatId = f.id;
      // A guide that's showing follows the new format; one that's off stays off.
      if (p.safeZone !== "none") p.safeZone = f.safeZone;
    });
    setOpen(false);
  };
  const toggleSafe = () => update((p) => void (p.safeZone = p.safeZone === "none" ? (getFormat(p.formatId).safeZone === "none" ? "reels" : getFormat(p.formatId).safeZone) : "none"));

  // Focus the search and bring the current format into view on open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  }, [open]);
  // Close on a press outside the picker.
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);
  // Keep the keyboard row visible.
  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter" && results[active]) {
      e.preventDefault();
      choose(results[active]);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button type="button" className="pill" onClick={() => (open ? setOpen(false) : openPicker())} aria-haspopup="listbox" aria-expanded={open} aria-label="Frame format" data-format-pill>
        <PlatformBadge format={format} size={18} />
        <span>{displayName(format)}</span>
        <span className="text-label-2">({format.ratio})</span>
        <ChevronDown size={14} className={cx("text-label-2 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div
          className="absolute bottom-full left-1/2 z-40 mb-2 flex max-h-[min(34rem,70vh)] w-[24rem] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-sys-gray4 bg-[#1c1c1e]/98 shadow-2xl shadow-black/60 backdrop-blur"
          onKeyDown={onKey}
          data-format-picker
        >
          <label className="flex items-center gap-2 border-b border-sys-gray4 px-4 py-3">
            <Search size={16} className="shrink-0 text-label-2" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              placeholder="Search…"
              className="w-full bg-transparent text-[14px] text-white placeholder:text-label-2 focus:outline-none"
              aria-label="Search formats"
              aria-controls="format-list"
              spellCheck={false}
            />
          </label>
          <div ref={listRef} id="format-list" role="listbox" aria-label="Frame formats" className="no-scrollbar min-h-0 flex-1 overflow-y-auto py-1.5">
            {groups.length === 0 && <p className="rf-read-note px-4 py-6 text-center">No format matches &ldquo;{query}&rdquo;.</p>}
            {groups.map((g) => (
              <div key={g.platform} role="group" aria-label={g.platform}>
                <p className="caps px-4 pb-1 pt-2.5">{g.platform === "Generic" ? "Any platform" : g.platform}</p>
                {g.items.map(({ f, i }) => {
                  const current = f.id === project.formatId;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      role="option"
                      aria-selected={current}
                      data-index={i}
                      data-format={f.id}
                      onPointerMove={() => setActive(i)}
                      onClick={() => choose(f)}
                      className={cx("mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-3 rounded-[10px] px-2.5 py-2 text-left text-[13.5px]", i === active ? "bg-white/10" : "", current ? "font-semibold text-white" : "text-white/90")}
                    >
                      <PlatformBadge format={f} />
                      <span className="min-w-0 flex-1 truncate">
                        {displayName(f)} <span className="font-normal text-label-2">({f.ratio})</span>
                      </span>
                      {current && <Check size={16} className="shrink-0 text-sys-blue" />}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <button type="button" role="switch" aria-checked={safeOn} onClick={toggleSafe} className="flex items-center gap-3 border-t border-sys-gray4 px-4 py-3 text-left text-[13.5px] hover:bg-white/5" data-safe-toggle>
            <Eye size={16} className="shrink-0 text-label-2" />
            <span className="flex-1">Show safe-zone overlay</span>
            <span className={cx("relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors", safeOn ? "bg-sys-green" : "bg-sys-gray3")}>
              <span className={cx("absolute top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow transition-all", safeOn ? "left-[18px]" : "left-[2px]")} />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
