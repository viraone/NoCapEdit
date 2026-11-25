"use client";

import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { CheckCircle2, ChevronRight, Clapperboard, FolderOpen, PlusCircle, Send, Share } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { phoneBridge, sendToPhone, type PhoneInfo } from "@/lib/phone/phoneBridge";
import { usePhone, type FinishedExport } from "@/lib/phone/phoneStore";
import { formatBytes } from "@/lib/utils/time";
import { useEditor } from "@/store/editorStore";
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
  // A new export starts the panel afresh: no leftover status, no file picked for the one before.
  return <Body key={done?.at ?? 0} done={done} />;
}

function Body({ done }: { done: FinishedExport | null }) {
  const setPhoneOpen = usePhone((s) => s.setOpen);
  const setTool = useEditor((s) => s.setTool);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState<{ text: string; kind: "busy" | "ok" | "error" } | null>(null);
  const [reelOpen, setReelOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState(false);
  /** A file the user picked, or an export read back from disk. A picked file wins over the export. */
  const [picked, setPicked] = useState<{ video: Blob; name: string; chosen: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Action | null>(null);

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
  }, [round]);

  if (!phoneBridge()) {
    return (
      <>
        <PanelHeader title="Instagram" description="Posting from the editor works in the NoCap Edit desktop app." />
      </>
    );
  }

  const source = picked?.chosen ? picked.video : (done?.video ?? picked?.video ?? null);
  const name = picked?.chosen ? picked.name : (done?.fileName ?? picked?.name ?? "video.mp4");
  const busy = status?.kind === "busy";
  const ready = !!info?.available;

  /** Copies the video to the phone unless it is there already; returns its gallery address. */
  const ensureSent = async (from: Blob, onLabel: (label: string) => void) => {
    const already = usePhone.getState().sent;
    if (already?.video === from) return already.uri;
    const api = phoneBridge();
    if (!api) throw new Error("The phone connection is not available.");
    onLabel("Sending the video to the phone");
    const { uri } = await sendToPhone(api, from, name);
    usePhone.getState().setSent({ video: from, uri });
    return uri;
  };

  const act = async (what: Action, from: Blob | null = source) => {
    if (!from && done?.loadVideo) {
      // The export went straight to disk: read it back from where it was saved.
      try {
        from = await done.loadVideo();
        setPicked({ video: from, name: done.fileName, chosen: false });
      } catch {
        from = null;
      }
    }
    if (!from) {
      // Nothing to post yet, or it could not be read back: ask for a file, then carry on with the same button.
      pending.current = what;
      fileRef.current?.click();
      return;
    }
    if (what === "reel") {
      setStatus(null);
      setReelOpen(true);
      return;
    }
    if (what === "story") {
      setStatus(null);
      setStoryOpen(true);
      return;
    }
    setStatus({ text: "Sending the video to the phone", kind: "busy" });
    try {
      await ensureSent(from, () => undefined);
      setStatus({ text: `Sent. ${name} is the newest video in the phone's gallery.`, kind: "ok" });
    } catch (e) {
      setStatus({ text: clean(e, "The emulator did not answer."), kind: "error" });
    }
  };

  return (
    <>
      <PanelHeader title="Instagram" description="Post it from the phone on the right." />
      <PanelSection>
        {picked?.chosen ? (
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3" data-instagram-video>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sys-blue/15 text-sys-blue"><FolderOpen size={17} /></span>
            <span className="min-w-0">
              <span className="rf-read-face block truncate text-[13.5px] font-semibold text-white" title={picked.name}>{picked.name}</span>
              <span className="rf-read-face block text-[12px] text-white/60">Your file · {formatBytes(picked.video.size)}</span>
            </span>
          </div>
        ) : done ? (
          <div className="flex items-center gap-3 rounded-2xl border border-sys-green/30 bg-linear-to-br from-sys-green/15 to-sys-green/[0.03] p-3" data-instagram-video>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sys-green/20 text-sys-green"><CheckCircle2 size={18} /></span>
            <span className="min-w-0">
              <span className="rf-read-face block truncate text-[13.5px] font-semibold text-white" title={done.fileName}>{done.fileName}</span>
              <span className="rf-read-face block text-[12px] text-sys-green">Exported · {formatBytes(done.bytes)} · {done.streamed ? "saved where you chose" : "saved to Downloads"}</span>
            </span>
          </div>
        ) : (
          <p className="rf-read-note rounded-2xl border border-dashed border-white/15 p-3" data-instagram-video>
            Nothing has been exported since this project was opened. Export the video first, or pick a video file below.
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
            const what = pending.current;
            pending.current = null;
            if (!file) return;
            setPicked({ video: file, name: file.name, chosen: true });
            setStatus(null);
            if (what) void act(what, file);
          }}
        />

        <div className="flex flex-col gap-2">
          <ActionCard hero icon={<Clapperboard size={20} />} title="Post / Reel" text="Caption, location, tags." disabled={!ready || !info?.instagram || busy} onClick={() => void act("reel")} data-instagram-reel />
          <ActionCard icon={<PlusCircle size={20} />} title="Story" text="Link, text, Highlight." disabled={!ready || !info?.instagram || busy} onClick={() => void act("story")} data-instagram-story />
          <ActionCard icon={<Send size={19} />} title="Send to phone" text="Copy to the gallery." disabled={!ready || busy} onClick={() => void act("send")} data-instagram-send />
        </div>

        {info && !info.available && (
          <p className="rf-read-note rf-warn" data-instagram-missing>
            {info.reason ?? "Start the Android emulator first."}{" "}
            <button type="button" className="underline hover:text-white" onClick={() => setRound((r) => r + 1)}>
              Check again
            </button>
          </p>
        )}
        {info?.available && !info.instagram && <p className="rf-read-note">Instagram is not installed on the emulator, so only Send to phone works.</p>}
        {status && (
          <p className={`rf-read-note ${status.kind === "ok" ? "rf-ok" : status.kind === "error" ? "rf-error" : ""}`} data-instagram-status>
            {status.text}
            {status.kind === "busy" ? "…" : ""}
          </p>
        )}
      </PanelSection>

      <PanelSection>
        <div className="flex flex-wrap items-center justify-center gap-1.5 border-t border-white/10 pt-3">
          <button
            type="button"
            className="rf-read-face inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[12px] font-medium text-white/70 transition-colors enabled:hover:border-white/25 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            disabled={busy}
            onClick={() => {
              pending.current = null;
              fileRef.current?.click();
            }}
            data-instagram-pick
          >
            <FolderOpen size={13} /> Another video
          </button>
          {picked?.chosen && done && (
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

      {source && (
        <PostReelDialog
          open={reelOpen}
          onClose={() => setReelOpen(false)}
          prepare={async (onLabel) => {
            setPhoneOpen(true);
            return ensureSent(source, onLabel);
          }}
        />
      )}
      {source && (
        <StoryDialog
          open={storyOpen}
          onClose={() => setStoryOpen(false)}
          prepare={async (onLabel) => {
            setPhoneOpen(true);
            return ensureSent(source, onLabel);
          }}
        />
      )}
    </>
  );
}
