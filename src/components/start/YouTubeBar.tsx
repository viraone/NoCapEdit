"use client";
import { useRef, useState, type FormEvent } from "react";
import { ClipboardPaste, CircleCheck, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { parseMediaLink, SITE_NAME, YOUTUBE_FORMATS, YOUTUBE_QUALITIES, type YouTubeChoice, type YouTubeFormat, type YouTubeQuality } from "@/lib/youtube/url";
import { cx } from "@/lib/utils/cx";

const control =
  "rounded-xl border border-sys-gray4 bg-sys-gray5 text-[15px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 disabled:opacity-50";

/**
 * Paste-a-link card for Instagram Reels and YouTube videos. It says in plain words
 * what it does and what to do (copy the link, paste it, press the button), and
 * confirms what it recognised as soon as a link is in the box. MP3 and quality are
 * secondary choices under the button; a Reel comes at its full size, so the quality
 * picker hides when the pasted link is Instagram's.
 * `onSubmit` throws when the text is not a link the helper takes; the message shows under the box.
 */
export function YouTubeBar({ onSubmit, disabled }: { onSubmit: (link: string, choice: YouTubeChoice) => void; disabled?: boolean }) {
  const [link, setLink] = useState("");
  const [format, setFormat] = useState<YouTubeFormat>("mp4");
  const [quality, setQuality] = useState<YouTubeQuality>(1080);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
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
    <section className="card mt-10 rounded-3xl p-5 sm:p-7" aria-labelledby="link-import-title">
      <h2 id="link-import-title" className="text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl">
        Turn an Instagram Reel into an MP4, or a YouTube link into an MP4 or MP3
      </h2>
      <p className="mt-2 text-[15px] leading-snug text-label-2">
        Paste the link below. <b className="font-semibold text-white">Instagram Reels are MP4 only.</b> <b className="font-semibold text-white">YouTube links</b> can be an MP4 (the video, saved to Your projects, ready to caption and edit) or an MP3 (just the sound, saved to your Downloads).
      </p>

      <form onSubmit={submit} className="mt-5">
        <div className="relative">
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
            className={cx(control, "h-14 w-full pl-4 pr-28 text-base")}
            data-youtube-link
          />
          <button
            type="button"
            onClick={paste}
            disabled={disabled}
            className="absolute right-2 top-1/2 inline-flex h-10 -translate-y-1/2 items-center gap-1.5 rounded-lg bg-sys-gray4 px-3 text-sm font-semibold text-white transition-colors hover:bg-sys-gray3 focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-blue/60 disabled:opacity-50"
            data-youtube-paste
          >
            <ClipboardPaste size={16} /> Paste
          </button>
        </div>

        <p className="mt-2 min-h-5 text-sm" aria-live="polite" data-youtube-recognised={media ? media.source : ""}>
          {media ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-sys-green">
              <CircleCheck size={16} /> {isInstagram ? "Instagram Reel link. It will be converted to an MP4." : `${SITE_NAME[media.source]} link. Ready to convert.`}
            </span>
          ) : link.trim() ? (
            <span className="text-label-3">That doesn&apos;t look like an Instagram Reel or YouTube link yet.</span>
          ) : null}
        </p>

        <div role="radiogroup" aria-label="Save as" className="mt-1 grid grid-cols-2 gap-2" data-youtube-format={chosen}>
          {YOUTUBE_FORMATS.map((f) => {
            const unavailable = f === "mp3" && isInstagram;
            return (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={chosen === f}
                aria-disabled={unavailable || undefined}
                onClick={() => {
                  if (!unavailable) setFormat(f);
                }}
                disabled={disabled}
                className={cx(
                  "rounded-xl border px-3 py-2.5 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-blue/60 disabled:opacity-50",
                  chosen === f ? "border-sys-blue bg-sys-blue/15 text-white" : "border-sys-gray4 bg-sys-gray5 text-label-2 hover:bg-sys-gray4",
                  unavailable && "cursor-not-allowed opacity-50 hover:bg-sys-gray5",
                )}
                data-youtube-format-option={f}
              >
                <span className="block text-[15px] font-bold">{f.toUpperCase()}</span>
                <span className="block text-xs text-label-3">
                  {unavailable ? "Not for Instagram Reels" : f === "mp4" ? "Video, to edit here" : "YouTube sound only, to Downloads"}
                </span>
              </button>
            );
          })}
        </div>

        <Button type="submit" variant="primary" size="lg" disabled={disabled || !link.trim()} className="mt-3 h-14 w-full text-base" data-youtube-convert>
          <Download size={20} /> {chosen === "mp3" ? "Convert to MP3" : "Convert to MP4"}
        </Button>

        {chosen === "mp4" && !isInstagram && (
          <label className="mt-4 flex items-center gap-2 text-sm text-label-2">
            Quality
            <select aria-label="Video quality" value={quality} onChange={(e) => setQuality(Number(e.target.value) as YouTubeQuality)} disabled={disabled} className={cx(control, "h-10 px-3")} data-youtube-quality>
              {YOUTUBE_QUALITIES.map((q) => (
                <option key={q} value={q}>
                  {q}p
                </option>
              ))}
            </select>
          </label>
        )}
      </form>

      {error && (
        <p className="mt-3 text-sm text-sys-red" role="alert">
          {error}
        </p>
      )}

      <div className="mt-5 border-t border-sys-gray5 pt-4 text-sm leading-relaxed text-label-3">
        <p>
          <b className="font-semibold text-label-2">Instagram:</b> open the Reel, tap the paper-plane Share button, then Copy link.
        </p>
        <p className="mt-1">
          <b className="font-semibold text-label-2">YouTube:</b> tap Share under the video, then Copy.
        </p>
        <p className="mt-2">
          {isInstagram
            ? "Instagram Reels are converted to MP4 only, at their full size. The video stays in this browser; nothing is uploaded anywhere."
            : chosen === "mp3"
              ? "The sound is saved to your Downloads folder as an MP3. MP3 is for YouTube links only. Nothing is uploaded anywhere."
              : "The video stays in this browser; nothing is uploaded anywhere. An Instagram Reel always comes out as an MP4."}
        </p>
      </div>
    </section>
  );
}
