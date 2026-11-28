"use client";
import { useEffect, useState } from "react";
import { Smile, Play, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { useProject } from "./shared";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { useRecap, recapKey } from "@/lib/recap/recapStore";
import { playRange } from "@/lib/recap/laughMoments";
import { trailerRanges, totalLength } from "@/lib/recap/trailerRanges";
import { layoutClips } from "@/lib/models/timeline";
import type { Laugh } from "@/lib/recap/findLaughs";

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function RecapPanel() {
  const project = useProject();
  const router = useRouter();
  const { key, laughs, job, error, run, cancel, kept, toggleKeep, making, trailerId, make, cancelMake } = useRecap();
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingRange, setPlayingRange] = useState<{ start: number; end: number } | null>(null);

  const clips = project?.clips ?? [];
  const currentKey = project ? recapKey(project.id, clips) : "";
  const showResults = key === currentKey && laughs !== null;

  const duration = layoutClips(clips).reduce((max, l) => Math.max(max, l.end), 0);
  const keptLaughs = (laughs ?? []).filter((l) => kept.includes(l.id));
  const cues = project?.cues ?? [];
  const hasCues = cues.length > 0;
  const keptSeconds = keptLaughs.length
    ? Math.round(totalLength(trailerRanges(keptLaughs, cues, duration)))
    : 0;

  const handlePlay = (laugh: Laugh) => {
    if (playingId === laugh.id) {
      engine.pause();
      setPlayingId(null);
      setPlayingRange(null);
      return;
    }
    const range = playRange(laugh, duration, 8, 1);
    useEditor.getState().seek(range.start);
    // The engine plays; the store's isPlaying only mirrors it.
    engine.play();
    setPlayingId(laugh.id);
    setPlayingRange(range);
  };

  useEffect(() => {
    if (!playingId || !playingRange) return;

    // Pausing changes the store, which calls this listener again before React unsubscribes it:
    // the flag stops it from pausing itself forever.
    let done = false;
    const unsub = useEditor.subscribe(({ currentTime, isPlaying }) => {
      if (done) return;
      const reachedEnd = currentTime >= playingRange.end && currentTime <= playingRange.end + 0.5;
      const movedAway = currentTime < playingRange.start - 0.5 || currentTime > playingRange.end + 0.5;
      if (!reachedEnd && !movedAway && isPlaying) return;
      done = true;
      if (reachedEnd) engine.pause();
      setPlayingId(null);
      setPlayingRange(null);
    });

    return () => unsub();
  }, [playingId, playingRange]);

  return (
    <>
      <PanelHeader
        title="Recap Highlight Reel"
        body={<p className="rf-read">Finds the biggest laughs in your video, on this Mac.</p>}
      />
      <PanelSection title="Find the laughs">
        {!project || !clips.length ? (
          <EmptyState icon={<Smile size={22} />} title="No video yet" description="Import a recording in Clips first." />
        ) : (
          <>
            {!job && (
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                onClick={() => run()}
                disabled={!!job || !clips.length}
                data-recap-find
              >
                <Smile size={15} /> {laughs ? "Find again" : "Find the laughs"}
              </Button>
            )}
            {job && (
              <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-recap-status>
                <p className="text-[13px] font-semibold text-white">{job.message}</p>
                <ProgressBar value={job.progress} />
                {job.progress !== null && (
                  <p className="text-[11px] text-label-2">{Math.round(job.progress * 100)}%</p>
                )}
                <Button variant="outline" size="xs" onClick={cancel}>
                  <Square size={11} /> Cancel
                </Button>
              </div>
            )}
            {error && <p className="rf-read-note rf-error mt-2">{error}</p>}
            {showResults && laughs.length > 0 && (
              <div className="mt-4 space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5">
                {kept.length === 0 ? (
                  <p className="rf-read-note">Tick the ones to keep. About 6 or 7 makes a 30 second trailer.</p>
                ) : (
                  <p className="text-[13px] font-semibold text-white">{kept.length} kept, about {keptSeconds} s</p>
                )}
                {!hasCues && (
                  <p className="rf-read-note">No captions yet. Make them in Subtitles first and the trailer will have captions and cleaner cuts.</p>
                )}
                {!making && (
                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => make()}
                    disabled={kept.length === 0 || !!making}
                    data-recap-make
                  >
                    Make the trailer
                  </Button>
                )}
                {making && (
                  <div className="space-y-2" data-recap-making>
                    <p className="text-[13px] font-semibold text-white">{making.message}</p>
                    <ProgressBar value={making.progress} />
                    {making.progress !== null && (
                      <p className="text-[11px] text-label-2">{Math.round(making.progress * 100)}%</p>
                    )}
                    <Button variant="outline" size="xs" onClick={cancelMake}>
                      <Square size={11} /> Cancel
                    </Button>
                  </div>
                )}
              </div>
            )}
            {showResults && trailerId && (
              <div className="mt-2 space-y-2">
                <p className="rf-read-note">Trailer made.</p>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => {
                    engine.pause();
                    router.push(`/editor?id=${trailerId}&tool=recap`);
                  }}
                  data-recap-open
                >
                  Open the trailer
                </Button>
              </div>
            )}
            {showResults && (
              laughs.length === 0 ? (
                <p className="rf-read-note mt-2">No laughs were found.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  <p className="text-[13px] font-semibold text-white">{laughs.length} moments, biggest first</p>
                  <ul className="space-y-1.5">
                    {laughs.map((laugh, i) => {
                      const rank = i + 1;
                      const seconds = Math.max(1, Math.round(laugh.end - laugh.start));
                      const isPlaying = playingId === laugh.id;
                      const isKept = kept.includes(laugh.id);
                      return (
                        <li key={laugh.id} className="rounded-lg border border-sys-gray4 bg-sys-gray5/60 px-2.5 py-2 flex items-center gap-2" data-recap-laugh>
                          <input
                            type="checkbox"
                            checked={isKept}
                            onChange={() => toggleKeep(laugh.id)}
                            data-recap-keep
                            aria-label={`Keep moment ${rank}`}
                          />
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-gray4 text-[11px] font-semibold text-white/80">{rank}</span>
                          <span className="shrink-0 text-[13px] text-white tabular-nums">{formatTime(laugh.start)}</span>
                          <span className="min-w-0 flex-1 truncate text-[11px] text-label-2">{seconds} s laugh</span>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handlePlay(laugh)}
                            data-recap-play
                            aria-label={`Play moment ${rank}`}
                          >
                            {isPlaying ? <Square size={11} /> : <Play size={11} />} {isPlaying ? "Stop" : "Play"}
                          </Button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )
            )}
          </>
        )}
      </PanelSection>
    </>
  );
}
