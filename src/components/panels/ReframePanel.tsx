"use client";
import { useEffect, useRef, useState } from "react";
import { ScanFace, Square, Undo2, RotateCcw } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import type { Clip } from "@/lib/models/project";
import { getFormat } from "@/lib/models/formats";
import { reframeAll, reframePlan } from "@/lib/tracking/reframeAll";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatTime } from "@/lib/utils/time";

interface Job {
  clipId: string;
  index: number;
  count: number;
  message: string;
  progress: number | null;
}

/**
 * Auto-Reframe: one button that makes the picture follow the comedian's face
 * in every clip, so the user never drags the frame around by hand. The face
 * tracker is the same one Trim offers per clip; it runs on this device.
 */
export function ReframePanel() {
  const project = useProject();
  const format = getFormat(project.formatId);
  const [job, setJob] = useState<Job | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const videos = project.clips.filter((c) => !c.still);
  const pictures = project.clips.length - videos.length;
  const followed = videos.filter((c) => c.reframe?.keyframes.length).length;
  const todo = reframePlan(project.clips);

  const run = async (clips: Clip[]) => {
    if (!clips.length || job) return;
    setErrors({});
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ clipId: clips[0].id, index: 0, count: clips.length, message: "Starting", progress: null });
    const store = useEditor.getState();
    let done = 0;
    // One undo step for the whole run, however many clips it touched.
    store.beginTransaction();
    try {
      await reframeAll({
        clips,
        urls: store.assetUrls,
        frame: { width: format.width, height: format.height },
        signal: controller.signal,
        onProgress: (p) => setJob({ clipId: p.clip.id, index: p.index, count: p.count, message: p.message, progress: p.progress }),
        onClipDone: (clip, r) => {
          if ("error" in r) {
            setErrors((e) => ({ ...e, [clip.id]: r.error }));
            return;
          }
          done++;
          useEditor.getState().update((p) => {
            const c = p.clips.find((c) => c.id === clip.id);
            if (c) c.reframe = { keyframes: r.keyframes, label: "Face tracking" };
          });
        },
      });
      store.setNotice(done ? `The picture now follows the face in ${done} clip${done === 1 ? "" : "s"}. Undo takes it back.` : "No face was found, so the picture stays where it is.");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") store.setNotice(done ? `Stopped. ${done} clip${done === 1 ? "" : "s"} now follow${done === 1 ? "s" : ""} the face.` : "Stopped. Nothing was changed.");
      else store.setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      store.endTransaction();
      abortRef.current = null;
      setJob(null);
    }
  };

  const makeStatic = (id: string) =>
    useEditor.getState().update((p) => {
      const c = p.clips.find((c) => c.id === id);
      if (c) c.reframe = null;
    });

  const jobClip = job ? project.clips.find((c) => c.id === job.clipId) : null;

  return (
    <>
      <PanelHeader
        title="Auto-Reframe"
        body={
          <ol className="rf-read rf-steps" data-reframe-steps>
            <li>
              <span>
                <b>Press</b> Reframe for me
              </span>
            </li>
            <li>
              <span>
                <b>Watch</b> the picture follow the comedian in every clip
              </span>
            </li>
            <li>
              <span>
                <b>Export</b> as usual; the following is kept
              </span>
            </li>
          </ol>
        }
      />
      <PanelSection title="Keep the comedian in the frame">
        {!videos.length ? (
          <EmptyState icon={<ScanFace size={22} />} title="No video yet" description="Import a recording in Clips first. Pictures have no face to follow." />
        ) : (
          <>
            {!job && todo.length > 0 && (
              <Button variant="primary" size="lg" className="w-full" onClick={() => run(todo)} data-reframe-run>
                <ScanFace size={15} /> Reframe for me
              </Button>
            )}
            {!job && todo.length === 0 && (
              <div className="flex items-center justify-between rf-read-face rounded-lg border border-sys-green/40 bg-sys-green/10 px-2 py-1.5 text-[13px] text-sys-green" data-reframe-all-done>
                <span>
                  Every clip follows the face ({followed} of {videos.length})
                </span>
                <Button variant="ghost" size="xs" onClick={() => run(reframePlan(project.clips, true))} title="Scan every clip again">
                  <RotateCcw size={11} /> Redo all
                </Button>
              </div>
            )}
            {job && (
              <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5 p-2.5" data-reframe-job>
                <p className="text-[13px] font-semibold text-white">
                  Clip {job.index + 1} of {job.count}
                  {jobClip && <span className="font-normal text-label-2"> · {jobClip.name}</span>}
                </p>
                <ProgressBar value={job.progress} />
                <p className="rf-read-note">{job.message}</p>
                <Button variant="outline" size="xs" onClick={() => abortRef.current?.abort()}>
                  <Square size={11} /> Stop
                </Button>
              </div>
            )}
            <p className="rf-read-note">
              Finds the person in each clip and moves the picture like a camera operator: it holds still while they stand still, cuts straight to the new framing when the video changes shot, and glides to keep their head
              centred in the {format.ratio} frame when they walk. Runs on this device at 4 frames a second; nothing is sent anywhere.
            </p>
            {pictures > 0 && (
              <p className="rf-read-note">
                {pictures} picture{pictures === 1 ? " is" : "s are"} skipped: a picture has no one to follow.
              </p>
            )}
          </>
        )}
      </PanelSection>
      {videos.length > 0 && (
        <PanelSection title="Clips" right={<span className="text-[11px] text-label-2">{followed} of {videos.length} following</span>}>
          <ul className="space-y-1.5" data-reframe-clips>
            {videos.map((c, i) => {
              const following = !!c.reframe?.keyframes.length;
              const scanning = job?.clipId === c.id;
              const error = errors[c.id];
              return (
                <li key={c.id} className="rounded-lg border border-sys-gray4 bg-sys-gray5/60 px-2.5 py-2" data-reframe-clip={following ? "following" : scanning ? "scanning" : "static"}>
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sys-gray4 text-[11px] font-semibold text-white/80">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-white" title={c.name}>
                      {c.name}
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-label-2">{formatTime(c.duration)}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 pl-7">
                    {scanning ? (
                      <span className="min-w-0 truncate text-[12px] text-sys-blue">Scanning…</span>
                    ) : following ? (
                      <span className="min-w-0 truncate text-[12px] text-sys-green" title={`${c.reframe!.keyframes.length} keyframes`}>
                        Following the face
                      </span>
                    ) : (
                      <span className="min-w-0 truncate text-[12px] text-label-2" title="The picture stays where you put it">
                        Static
                      </span>
                    )}
                    {!job && (
                      <span className="flex shrink-0 gap-1">
                        {following && (
                          <Button variant="ghost" size="xs" onClick={() => makeStatic(c.id)} title="Stop following the face in this clip">
                            <Undo2 size={11} /> Static
                          </Button>
                        )}
                        <Button variant="ghost" size="xs" onClick={() => run([c])} title={following ? "Scan this clip again" : "Follow the face in this clip"}>
                          {following ? <RotateCcw size={11} /> : <ScanFace size={11} />} {following ? "Redo" : "Follow"}
                        </Button>
                      </span>
                    )}
                  </div>
                  {error && <p className="rf-read-note rf-error mt-1 pl-7">{error}</p>}
                </li>
              );
            })}
          </ul>
        </PanelSection>
      )}
    </>
  );
}
