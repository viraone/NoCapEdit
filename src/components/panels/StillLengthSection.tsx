"use client";
import { Music2 } from "lucide-react";
import type { Clip, VideoProject } from "@/lib/models/project";
import { MAX_STILL_SECONDS } from "@/lib/media/stillLength";
import { formatTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";
import { NumberInput } from "@/components/ui/NumberInput";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useIsStill, useStillLength } from "./useStillLength";

/** "Show this picture for": the length of a picture clip, with a one-click match to the music. Renders nothing for a real video. */
export function StillLengthSection({ clip, project }: { clip: Clip; project: VideoProject }) {
  const still = useIsStill(clip);
  const { run, status, error, busy } = useStillLength();
  if (!still) return null;
  const shown = (clip.outPoint - clip.inPoint) / clip.speed;
  const music = project.music;
  const song = music ? Math.max(0, music.duration - music.startOffset) : 0;
  return (
    <div className="space-y-2.5 px-4 py-3" data-still-length>
      <h3 className="caps">Show this picture for</h3>
      <p className="rf-read-note">
        This clip is a <b>picture</b>. Choose how long it stays on screen.
      </p>
      <div className="flex items-center gap-2">
        <div className="w-28">
          <NumberInput value={shown} min={1} max={MAX_STILL_SECONDS} step={1} decimals={1} suffix="s" disabled={busy} onCommit={(v) => void run(clip.id, v)} />
        </div>
        <span className="rf-read-note">{formatTime(shown)}</span>
      </div>
      {song > 0 && Math.abs(song - shown) > 0.5 && (
        <Button variant="secondary" size="sm" className="w-full" disabled={busy} onClick={() => void run(clip.id, Math.min(MAX_STILL_SECONDS, song))} data-match-music>
          <Music2 size={13} /> Match the music · {formatTime(song)}
        </Button>
      )}
      {busy && (
        <div className="space-y-1.5" data-still-busy>
          <ProgressBar value={null} />
          <p className="rf-read-note">{status}</p>
        </div>
      )}
      {error && <p className="rf-read-note rf-error whitespace-pre-wrap">{error}</p>}
    </div>
  );
}
