"use client";
import { Play, Pause, SkipBack, SkipForward } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { engine } from "@/lib/playback/engine";
import { projectDuration } from "@/lib/models/timeline";
import { formatTime } from "@/lib/utils/time";
import { Button } from "@/components/ui/Button";

export function TransportBar() {
  const isPlaying = useEditor((s) => s.isPlaying);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project.clips) : 0));
  const seek = useEditor((s) => s.seek);
  return (
    <div className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-neutral-800 px-3">
      <Button variant="ghost" size="iconSm" onClick={() => seek(0)} title="Go to start (Home)">
        <SkipBack size={15} />
      </Button>
      <Button variant="primary" size="icon" onClick={() => engine.toggle()} title="Play / pause (Space)" disabled={duration === 0}>
        {isPlaying ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
      </Button>
      <Button variant="ghost" size="iconSm" onClick={() => seek(duration)} title="Go to end (End)">
        <SkipForward size={15} />
      </Button>
      <span className="ml-2 w-32 text-center font-mono text-xs tabular-nums text-neutral-300">
        {formatTime(currentTime)} <span className="text-neutral-600">/</span> {formatTime(duration)}
      </span>
    </div>
  );
}
