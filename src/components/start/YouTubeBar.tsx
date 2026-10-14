"use client";
import { useState, type FormEvent } from "react";
import { RefreshCw, MonitorPlay } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { YOUTUBE_QUALITIES, type YouTubeQuality } from "@/lib/youtube/url";
import { cx } from "@/lib/utils/cx";

const control =
  "h-12 rounded-xl border border-sys-gray4 bg-sys-gray5 text-[15px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 disabled:opacity-50";

/**
 * Paste-a-link bar (the EzMP4 pattern: link, quality, Convert). `onSubmit`
 * throws when the text is not a YouTube link; the message shows under the bar.
 */
export function YouTubeBar({ onSubmit, disabled }: { onSubmit: (link: string, quality: YouTubeQuality) => void; disabled?: boolean }) {
  const [link, setLink] = useState("");
  const [quality, setQuality] = useState<YouTubeQuality>(1080);
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      onSubmit(link, quality);
      setLink("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="card mt-10 rounded-3xl p-5" aria-label="Import from YouTube">
      <form onSubmit={submit} className="flex flex-wrap items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sys-red/15 text-sys-red">
          <MonitorPlay size={24} />
        </div>
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          aria-label="YouTube link"
          placeholder="Paste a YouTube link here…"
          value={link}
          onChange={(e) => {
            setLink(e.target.value);
            if (error) setError(null);
          }}
          disabled={disabled}
          className={cx(control, "min-w-64 flex-1 px-4")}
          data-youtube-link
        />
        <select aria-label="Video quality" value={quality} onChange={(e) => setQuality(Number(e.target.value) as YouTubeQuality)} disabled={disabled} className={cx(control, "w-28 px-3")} data-youtube-quality>
          {YOUTUBE_QUALITIES.map((q) => (
            <option key={q} value={q}>
              {q}p
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" size="lg" disabled={disabled || !link.trim()} data-youtube-convert>
          <RefreshCw size={18} /> Convert
        </Button>
      </form>
      <p className="mt-3 text-sm text-label-3">
        The link goes to the YouTube helper, which sends the MP4 back. The video is saved in this browser as a new project under Your projects; it is never uploaded anywhere.
      </p>
      {error && (
        <p className="mt-2 text-sm text-sys-red" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
