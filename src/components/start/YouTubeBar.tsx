"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ClipboardPaste, CircleCheck, Download, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { youtubeStageText, type YouTubeImport } from "@/components/start/useYouTubeImports";
import { parseMediaLink, SITE_NAME, YOUTUBE_FORMATS, YOUTUBE_QUALITIES, type YouTubeChoice, type YouTubeFormat, type YouTubeQuality } from "@/lib/youtube/url";
import { cx } from "@/lib/utils/cx";
import { InstagramLogo, YouTubeLogo } from "@/components/start/BrandLogos";

const control =
  "rounded-xl border border-sys-gray4 bg-sys-gray5 text-[15px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 disabled:opacity-50";

const smallButton =
  "inline-flex h-8 items-center gap-1.5 rounded-lg bg-sys-gray4 px-2.5 text-[13px] font-semibold text-white transition-colors hover:bg-sys-gray3 focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-blue/60 disabled:opacity-50";

/**
 * Paste-a-link card for Instagram Reels and YouTube videos, kept to one row: the
 * link box (with Paste inside it) and the Download button, with the small choices
 * (MP4 or MP3, quality) on a single line underneath. It confirms what it recognised
 * as soon as a link is in the box. A Reel comes at its full size and only as MP4,
 * so for an Instagram link the MP3 pill is greyed out and the quality picker hides.
 * `onSubmit` throws when the text is not a link the helper takes; the message shows under the box.
 * While `active` is a download under way, a blue status block takes the row's place
 * (spinner, what is happening, percentage, Cancel), so nobody has to hunt for the card
 * further down the page to see that something is happening.
 */
export function YouTubeBar({
  onSubmit,
  disabled,
  active = null,
  onCancel,
}: {
  onSubmit: (link: string, choice: YouTubeChoice) => void;
  disabled?: boolean;
  active?: YouTubeImport | null;
  onCancel?: (key: string) => void;
}) {
  const [link, setLink] = useState("");
  const [format, setFormat] = useState<YouTubeFormat>("mp4");
  const [quality, setQuality] = useState<YouTubeQuality>(1080);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** The download that just finished, shown as a green "Done" line for a few seconds. */
  const [done, setDone] = useState<YouTubeImport | null>(null);
  const lastActive = useRef<YouTubeImport | null>(null);
  useEffect(() => {
    // The in-flight item disappears from `active` the moment it lands (an error keeps it, so it stays in the list).
    if (active) lastActive.current = active;
    else if (lastActive.current && lastActive.current.stage !== "error") {
      setDone(lastActive.current);
      lastActive.current = null;
      const t = setTimeout(() => setDone(null), 8000);
      return () => clearTimeout(t);
    }
  }, [active]);
  const media = parseMediaLink(link);
  const isInstagram = media?.source === "instagram";
  // An Instagram Reel is only ever converted to an MP4; the visitor's MP3 pick is kept for the next YouTube link.
  const chosen: YouTubeFormat = isInstagram ? "mp4" : format;

  const change = (value: string) => {
    setLink(value);
    if (error) setError(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onSubmit(link, { format: chosen, quality });
      setLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /** One tap pastes whatever link is on the clipboard; browsers that won't allow it get the manual hint. */
  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) {
        change(text);
        return;
      }
      setError("Nothing to paste yet. Copy the link first, then tap Paste.");
    } catch {
      setError("Your browser didn't allow that. Press and hold in the box, then tap Paste.");
      inputRef.current?.focus();
    }
  };

  return (
    <section className="card mt-8 rounded-2xl p-4 sm:p-5" aria-labelledby="link-import-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="link-import-title" className="text-lg font-semibold leading-tight tracking-tight text-white">
          Paste an <InstagramLogo size={20} className="mx-0.5" />Instagram Reel or <YouTubeLogo size={20} className="mx-0.5" />YouTube link
        </h2>
        <p className="text-sm text-label-3">It becomes a project you can caption and edit. Nothing is uploaded anywhere.</p>
      </div>

      <form onSubmit={submit} className="mt-3">
        {active ? (
          // A download under way: the row becomes the status block so the progress is where the visitor is looking.
          <div className="space-y-2 rounded-xl border-2 border-sys-blue bg-sys-blue/15 p-3 shadow-[0_0_0_4px_rgba(10,132,255,0.18)] motion-safe:animate-pulse" role="status" aria-live="polite" data-youtube-active={active.stage}>
            <p className="flex items-center gap-2 text-base font-bold leading-snug text-white">
              <Loader2 size={18} className="shrink-0 animate-spin text-sys-blue" aria-hidden />
              <span className="truncate">
                {active.stage === "saving" ? "Downloading" : active.stage === "importing" ? "Almost done" : `Getting the ${active.source === "instagram" ? "Reel" : "video"} from ${SITE_NAME[active.source]}`}… {active.title}
              </span>
            </p>
            <div className="flex items-start justify-between gap-2 text-[13px]">
              <span className="min-w-0 text-white/80 [overflow-wrap:anywhere]">{youtubeStageText(active)}</span>
              {active.stage === "saving" && active.total ? <span className="shrink-0 tabular-nums font-semibold text-white">{Math.round((active.loaded / active.total) * 100)}%</span> : null}
            </div>
            <ProgressBar className="h-2" value={active.stage === "saving" && active.total ? active.loaded / active.total : null} />
            <div className="flex items-center justify-between gap-2 text-xs text-white/70">
              <span>Keep this page open. It lands under Your projects when it is done.</span>
              {onCancel && (
                <Button variant="outline" size="sm" onClick={() => onCancel(active.key)}>
                  <X size={12} /> Cancel
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <input
                ref={inputRef}
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-label="Instagram Reel or YouTube link"
                placeholder="Paste the link here"
                value={link}
                onChange={(e) => change(e.target.value)}
                disabled={disabled}
                className={cx(control, "h-12 w-full pl-4 pr-24")}
                data-youtube-link
              />
              {link.trim() ? (
                <button
                  type="button"
                  onClick={() => {
                    change("");
                    inputRef.current?.focus();
                  }}
                  disabled={disabled}
                  aria-label="Clear the link"
                  className={cx(smallButton, "absolute right-2 top-1/2 w-8 -translate-y-1/2 justify-center px-0")}
                  data-youtube-clear
                >
                  <X size={16} />
                </button>
              ) : (
                <button type="button" onClick={paste} disabled={disabled} className={cx(smallButton, "absolute right-2 top-1/2 -translate-y-1/2")} data-youtube-paste>
                  <ClipboardPaste size={15} /> Paste
                </button>
              )}
            </div>
            <Button type="submit" variant="primary" size="lg" disabled={disabled || !link.trim()} className="h-12 text-[15px] sm:w-44" data-youtube-convert>
              <Download size={18} /> Download
            </Button>
          </div>
        )}

        {done && !active && (
          <p className="mt-2 flex items-center gap-2 rounded-xl border border-sys-green/50 bg-sys-green/10 px-3 py-2 text-sm font-semibold text-sys-green" role="status" data-youtube-done>
            <CircleCheck size={16} className="shrink-0" />
            <span>
              Done. {done.format === "mp3" ? "The MP3 is in your Downloads folder." : <>&ldquo;{done.title}&rdquo; is ready under <a href="#projects" className="underline">Your projects</a>.</>}
            </span>
          </p>
        )}

        {!active && (
          <div className="mt-2 flex min-h-6 flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]">
            <p className="min-w-0 basis-full sm:flex-1 sm:basis-0" aria-live="polite" data-youtube-recognised={media ? media.source : ""}>
              {media ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-sys-green">
                  <CircleCheck size={14} /> {isInstagram ? <InstagramLogo size={15} /> : <YouTubeLogo size={15} />}
                  {isInstagram ? "Instagram Reel. Comes out as an MP4." : `${SITE_NAME[media.source]} link. Ready to download.`}
                </span>
              ) : link.trim() ? (
                <span className="text-label-3">That doesn&apos;t look like an Instagram Reel or YouTube link yet.</span>
              ) : (
                <span className="text-label-3">
                  <InstagramLogo size={14} /> <b className="font-semibold text-label-2">Instagram:</b> Share, then Copy link. <YouTubeLogo size={14} className="ml-1" /> <b className="font-semibold text-label-2">YouTube:</b> Share, then Copy.
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <div role="radiogroup" aria-label="Save as" className="inline-flex rounded-lg bg-sys-gray5 p-0.5" data-youtube-format={chosen}>
                {YOUTUBE_FORMATS.map((f) => {
                  const unavailable = f === "mp3" && isInstagram;
                  return (
                    <button
                      key={f}
                      type="button"
                      role="radio"
                      aria-checked={chosen === f}
                      aria-disabled={unavailable || undefined}
                      title={unavailable ? "Instagram Reels come out as MP4 only" : f === "mp4" ? "The video, as a project you can edit here" : "YouTube sound only, saved to your Downloads"}
                      onClick={() => {
                        if (!unavailable) setFormat(f);
                      }}
                      disabled={disabled}
                      className={cx(
                        "rounded-md px-2.5 py-1 text-xs font-bold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-blue/60 disabled:opacity-50",
                        chosen === f ? "bg-sys-blue text-white" : "text-label-2 hover:text-white",
                        unavailable && "cursor-not-allowed opacity-40 hover:text-label-2",
                      )}
                      data-youtube-format-option={f}
                    >
                      {f.toUpperCase()}
                    </button>
                  );
                })}
              </div>
              {chosen === "mp4" && !isInstagram && (
                <select aria-label="Video quality" value={quality} onChange={(e) => setQuality(Number(e.target.value) as YouTubeQuality)} disabled={disabled} className={cx(control, "h-8 rounded-lg px-2 text-xs")} data-youtube-quality>
                  {YOUTUBE_QUALITIES.map((q) => (
                    <option key={q} value={q}>
                      {q}p
                    </option>
                  ))}
                </select>
              )}
              {chosen === "mp3" && <span className="text-xs text-label-3">Sound only, to Downloads</span>}
            </div>
          </div>
        )}
      </form>

      {error && (
        <p className="mt-2 text-sm text-sys-red" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
