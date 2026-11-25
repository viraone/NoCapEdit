"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Clapperboard, FolderOpen, PlusCircle, Send, Share } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { PanelHeader, PanelSection } from "@/components/ui/Panel";
import { phoneBridge, sendToPhone, type PhoneInfo } from "@/lib/phone/phoneBridge";
import { usePhone, type FinishedExport } from "@/lib/phone/phoneStore";
import { formatBytes } from "@/lib/utils/time";
import { useEditor } from "@/store/editorStore";
import { PostReelDialog } from "./PostReelDialog";
import { StoryDialog } from "./StoryDialog";

const clean = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback);

type Action = "reel" | "story" | "send";

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
      <PanelHeader title="Instagram" description="Post the finished video from the phone on the right." />
      <PanelSection>
        {picked?.chosen ? (
          <p className="rf-read-note flex items-center gap-1.5" data-instagram-video>
            <FolderOpen size={15} className="shrink-0" /> Posting {picked.name} · {formatBytes(picked.video.size)}
          </p>
        ) : done ? (
          <p className="rf-read-note rf-ok flex items-start gap-1.5 rounded-lg border border-sys-green/40 bg-sys-green/10 p-2.5" data-instagram-video>
            <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
            <span>
              Export finished: {done.fileName} · {formatBytes(done.bytes)} · {done.streamed ? "saved where you chose" : "saved to Downloads"}
            </span>
          </p>
        ) : (
          <p className="rf-read-note" data-instagram-video>
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
          <div>
            <Button variant="primary" className="w-full justify-start" disabled={!ready || !info?.instagram || busy} onClick={() => void act("reel")} data-instagram-reel>
              <Clapperboard size={15} /> Post / Reel
            </Button>
            <p className="rf-read-note mt-1">Set the caption and options first, then Instagram is walked through them.</p>
          </div>
          <div>
            <Button variant="secondary" className="w-full justify-start" disabled={!ready || !info?.instagram || busy} onClick={() => void act("story")} data-instagram-story>
              <PlusCircle size={15} /> Story
            </Button>
            <p className="rf-read-note mt-1">Set the link sticker and options first, then Instagram is walked through them.</p>
          </div>
          <div>
            <Button variant="secondary" className="w-full justify-start" disabled={!ready || busy} onClick={() => void act("send")} data-instagram-send>
              <Send size={15} /> Send to phone
            </Button>
            <p className="rf-read-note mt-1">Only copies the video into the phone&apos;s gallery.</p>
          </div>
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
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => {
              pending.current = null;
              fileRef.current?.click();
            }}
            data-instagram-pick
          >
            <FolderOpen size={11} /> Use another video file
          </Button>
          {picked?.chosen && done && (
            <Button variant="ghost" size="xs" disabled={busy} onClick={() => setPicked(null)} data-instagram-unpick>
              Back to the export
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={() => setTool("export")} data-instagram-to-export>
            <Share size={11} /> Export again
          </Button>
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
