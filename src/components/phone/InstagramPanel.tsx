"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, Clapperboard, FolderOpen, PlusCircle, Send, Share } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { emulatorIsOff } from "@/lib/phone/emulatorStart";
import { phoneBridge, sendToPhone, type PhoneInfo, type StorySlot } from "@/lib/phone/phoneBridge";
import { findStoryTitle, storyTitle } from "@/lib/phone/storyTitle";
import { projectDuration } from "@/lib/models/timeline";
import { usePhone, type FinishedExport } from "@/lib/phone/phoneStore";
import { formatBytes } from "@/lib/utils/time";
import { useEditor } from "@/store/editorStore";
import { useAiStyle } from "@/lib/phone/aiStyle";
import { exportFits } from "@/lib/phone/exportFits";
import { bakedMusicName } from "@/lib/phone/bakedMusic";
import { exportForPhone } from "@/lib/phone/exportForPhone";
import { friendlyExportError } from "@/lib/export/friendlyError";
import { EmulatorStart } from "./EmulatorStart";
import { PostReelDialog } from "./PostReelDialog";
import { StoryDialog } from "./StoryDialog";

const clean = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback);

type Action = "reel" | "story" | "send";

/** One thing to do with the video: a tile with an icon, a name and a line saying what happens. */
function ActionCard({ icon, title, text, hero = false, ...props }: { icon: ReactNode; title: string; text: string; hero?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "group flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-pink/70 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100",
        hero
          ? "border-white/20 bg-linear-to-br from-sys-purple via-sys-pink to-sys-orange shadow-lg shadow-sys-pink/25 enabled:hover:brightness-110"
          : "border-white/10 bg-white/[0.04] enabled:hover:border-white/25 enabled:hover:bg-white/[0.08]",
      )}
      {...props}
    >
      <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white", hero ? "bg-white/20" : "bg-white/[0.07] ring-1 ring-inset ring-white/10")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-bold tracking-wide text-white">{title}</span>
        <span className={cx("rf-read-face mt-0.5 block text-[12px] leading-snug", hero ? "text-white/90" : "text-white/60")}>{text}</span>
      </span>
      <ChevronRight size={16} className={cx("shrink-0 transition-transform group-enabled:group-hover:translate-x-0.5", hero ? "text-white" : "text-white/40")} />
    </button>
  );
}

/**
 * The Instagram tool (desktop app only): hand a finished export to the Android emulator and open
 * Instagram on it. It opens by itself when an export finishes. With no export yet, or to post
 * something else, a video file can be picked instead.
 */
export function InstagramPanel() {
  const done = usePhone((s) => s.lastExport);
  const round = usePhone((s) => s.exportRound);
  // A new export starts the panel afresh: no leftover status, no file picked for the one before.
  return <Body key={round} done={done} />;
}

function Body({ done }: { done: FinishedExport | null }) {
  const setPhoneOpen = usePhone((s) => s.setOpen);
  const setTool = useEditor((s) => s.setTool);
  const project = useEditor((s) => s.project);
  const music = useEditor((s) => s.project?.music ?? null);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState<{ text: string; kind: "busy" | "ok" | "error" } | null>(null);
  const [reelOpen, setReelOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  /** A file the user picked, or an export read back from disk. A picked file wins over the export. */
  const [picked, setPicked] = useState<{ video: Blob; name: string; chosen: boolean; of?: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const phoneRound = usePhone((s) => s.phoneRound);
  const [making, setMaking] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [posting, setPosting] = useState<{ video: Blob; name: string; fromProject: boolean } | null>(null);

  useEffect(() => {
    const api = phoneBridge();
    if (!api) return;
    let gone = false;
    void api
      .info()
      .then((i) => !gone && setInfo(i))
      .catch(() => !gone && setInfo({ available: false, reason: "The emulator did not answer." }));
    return () => {
      gone = true;
    };
  }, [round, phoneRound]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!phoneBridge()) {
    return (
      <>
        <PanelHeader title="Instagram" description="Posting from the editor works in the NoCap Edit desktop app." />
      </>
    );
  }

  const current = done && exportFits(done, project) ? done : null;
  const source = picked?.chosen ? picked.video : (current?.video ?? (current && picked?.of === current.at ? picked.video : null));
  const name = picked?.chosen ? picked.name : (current?.fileName ?? "video.mp4");
  const busy = status?.kind === "busy";
  const ready = !!info?.available;

  /** Copies the video to the phone unless it is there already; returns its gallery address. */
  const ensureSent = async (from: Blob, fileName: string, onLabel: (label: string) => void) => {
    const already = usePhone.getState().sent;
    if (already?.video === from) return already.uri;
    const api = phoneBridge();
    if (!api) throw new Error("The phone connection is not available.");
    onLabel("Sending the video to the phone");
    const { uri } = await sendToPhone(api, from, fileName);
    usePhone.getState().setSent({ video: from, uri });
    return uri;
  };

  /** "Style it" in the Story window: the words become an editor title, selected in the Text tool. */
  const styleText = (text: string, slot: StorySlot, ai: boolean) => {
    const editor = useEditor.getState();
    if (!editor.project) return;
    let title = findStoryTitle(editor.project.overlays, text);
    if (!title) {
      const made = storyTitle(text, slot, projectDuration(editor.project.clips));
      editor.update((p) => void p.overlays.push(made));
      title = made;
    }
    editor.select({ kind: "overlay", id: title.id });
    editor.setTool("text");
    if (ai && posting) void useAiStyle.getState().start({ overlayId: title.id, words: text, slot, video: posting.video });
  };

  const act = async (what: Action) => {
    let from = source;
    let fromName = name;
    const fromProject = !picked?.chosen;
    if (!from && current?.loadVideo) {
      try {
        from = await current.loadVideo();
        fromName = current.fileName;
        setPicked({ video: from, name: current.fileName, chosen: false, of: current.at });
      } catch {
        from = null;
      }
    }
    if (!from) {
      if (usePhone.getState().rendering) {
        setStatus({ text: "A video is already being made in the Export panel. Wait for it to finish.", kind: "error" });
        return;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      usePhone.getState().setRendering(true);
      setMaking(0);
      setStatus({ text: "Making the video", kind: "busy" });
      try {
        const made = await exportForPhone((p) => setMaking(Math.round(p.progress * 100)), controller.signal);
        if (controller.signal.aborted) {
          setStatus(null);
          return;
        }
        usePhone.getState().setOwnExport(made);
        if (!exportFits(made, useEditor.getState().project)) {
          setStatus({ text: "The project changed while the video was being made. Press the button again.", kind: "error" });
          return;
        }
        from = made.video;
        fromName = made.fileName;
      } catch (e) {
        setStatus(controller.signal.aborted ? null : { text: friendlyExportError(e), kind: "error" });
        return;
      } finally {
        usePhone.getState().setRendering(false);
        abortRef.current = null;
        setMaking(null);
      }
    }
    if (!from) return;
    const video = from;
    if (what === "reel" || what === "story") {
      setStatus(null);
      setPosting({ video, name: fromName, fromProject });
      if (what === "reel") setReelOpen(true);
      else setStoryOpen(true);
      return;
    }
    setStatus({ text: "Sending the video to the phone", kind: "busy" });
    try {
      await ensureSent(video, fromName, () => undefined);
      setStatus({ text: `Sent. ${fromName} is the newest video in the phone's gallery.`, kind: "ok" });
    } catch (e) {
      setStatus({ text: clean(e, "The emulator did not answer."), kind: "error" });
    }
  };

  return (
    <>
      <PanelHeader title="Instagram" description="Post it from the phone on the right." />
      <PanelSection>
        {info && emulatorIsOff(info) && (
          <EmulatorStart
            info={info}
            onCheck={() => setRound((r) => r + 1)}
            onStart={() => setPhoneOpen(true)}
          />
        )}
        {picked?.chosen ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3" data-instagram-video>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sys-blue/15 text-sys-blue"><FolderOpen size={17} /></span>
            <span className="min-w-0">
              <span className="rf-read-face block truncate text-[13.5px] font-semibold text-white" title={picked.name}>{picked.name}</span>
              <span className="rf-read-face block text-[12px] text-white/60">Your file · {formatBytes(picked.video.size)}</span>
            </span>
          </div>
        ) : current ? (
          <div className="flex items-center gap-3 rounded-2xl border border-sys-green/30 bg-linear-to-br from-sys-green/15 to-sys-green/[0.03] p-3" data-instagram-video>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sys-green/20 text-sys-green"><CheckCircle2 size={18} /></span>
            <span className="min-w-0">
              <span className="rf-read-face block truncate text-[13.5px] font-semibold text-white" title={current.fileName}>{current.fileName}</span>
              <span className="rf-read-face block text-[12px] text-sys-green">Exported · {formatBytes(current.bytes)} · {current.inApp ? "kept in the app" : current.streamed ? "saved where you chose" : "saved to Downloads"}</span>
            </span>
          </div>
        ) : (
          <p className="rf-read-note rounded-2xl border border-dashed border-white/15 p-3" data-instagram-video>
            {done && done.project.id === project?.id
              ? "The project changed since the last video was made, so a new one is made when you press a button below."
              : "The buttons below use this project: the video is made first. Or pick a different video file below."}
          </p>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="video/mp4,video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            e.target.value = "";
            if (!file) return;
            setPicked({ video: file, name: file.name, chosen: true });
            setStatus(null);
          }}
        />

        <div className="flex flex-col gap-2">
          <ActionCard hero icon={<Clapperboard size={20} />} title="Post / Reel" text="Caption, location, tags." disabled={!ready || !info?.instagram || busy} onClick={() => void act("reel")} data-instagram-reel />
          <ActionCard icon={<PlusCircle size={20} />} title="Story" text="Link, text, Highlight." disabled={!ready || !info?.instagram || busy} onClick={() => void act("story")} data-instagram-story />
          <ActionCard icon={<Send size={19} />} title="Send to phone" text="Copy to the gallery." disabled={!ready || busy} onClick={() => void act("send")} data-instagram-send />
        </div>

        {info && !info.available && !emulatorIsOff(info) && (
          <p className="rf-read-note rf-warn" data-instagram-missing>
            {info.reason ?? "Start the Android emulator first."}{" "}
            <button type="button" className="underline hover:text-white" onClick={() => setRound((r) => r + 1)}>
              Check again
            </button>
          </p>
        )}
        {info?.available && !info.instagram && <p className="rf-read-note">Instagram is not installed on the emulator, so only Send to phone works.</p>}
        {status && (
          <div className="flex items-center gap-2">
            <p className={`rf-read-note ${status.kind === "ok" ? "rf-ok" : status.kind === "error" ? "rf-error" : ""}`} data-instagram-status>
              {making !== null ? `${status.text}… ${making}%` : status.text}
              {status.kind === "busy" && making === null ? "…" : ""}
            </p>
            {making !== null && (
              <Button variant="outline" size="xs" onClick={() => abortRef.current?.abort()} data-instagram-stop-export>Stop</Button>
            )}
          </div>
        )}
      </PanelSection>

      <PanelSection>
        <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/10 pt-3">
          <button
            type="button"
            className="rf-read-face inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[12px] font-medium text-white/70 transition-colors enabled:hover:border-white/25 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            data-instagram-pick
          >
            <FolderOpen size={13} /> Another video
          </button>
          {picked?.chosen && current && (
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => setPicked(null)} data-instagram-unpick>
              Back to the export
            </Button>
          )}
          <button
            type="button"
            className="rf-read-face inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[12px] font-medium text-white/70 transition-colors enabled:hover:border-white/25 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            onClick={() => setTool("export")}
            data-instagram-to-export
          >
            <Share size={13} /> Export again
          </button>
        </div>
      </PanelSection>

      {posting && (
        <PostReelDialog
          open={reelOpen}
          onClose={() => setReelOpen(false)}
          prepare={async (onLabel) => {
            if (posting.fromProject && !exportFits(usePhone.getState().lastExport ?? null, useEditor.getState().project)) throw new Error("The project changed since this window opened. Close it and press the button again.");
            setPhoneOpen(true);
            return ensureSent(posting.video, posting.name, onLabel);
          }}
        />
      )}
      {posting && (
        <StoryDialog
          video={posting.video}
          open={storyOpen}
          onClose={() => setStoryOpen(false)}
          onStyle={posting.fromProject ? styleText : undefined}
          bakedMusic={bakedMusicName({ music }, posting.fromProject)}
          prepare={async (onLabel) => {
            if (posting.fromProject && !exportFits(usePhone.getState().lastExport ?? null, useEditor.getState().project)) throw new Error("The project changed since this window opened. Close it and press the button again.");
            setPhoneOpen(true);
            return ensureSent(posting.video, posting.name, onLabel);
          }}
        />
      )}
    </>
  );
}
