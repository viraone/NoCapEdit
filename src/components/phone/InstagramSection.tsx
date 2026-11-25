"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Clapperboard, FolderOpen, PlusCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { phoneBridge, sendToPhone, type PhoneInfo } from "@/lib/phone/phoneBridge";
import { usePhone } from "@/lib/phone/phoneStore";
import { PostReelDialog } from "./PostReelDialog";

const noSubscription = () => () => undefined;
const hasPhone = () => phoneBridge() !== null;
const clean = (e: unknown, fallback: string) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : fallback);

/**
 * "Instagram" buttons for a finished export (desktop app only): hand the video to the Android
 * emulator and open Instagram on it. `video` is the exported MP4 when the export kept it in
 * memory; an export saved straight to disk is read back with `loadVideo`, or picked from disk
 * when that is not possible.
 */
export function InstagramSection({ video, loadVideo, fileName }: { video: Blob | null; loadVideo: (() => Promise<Blob>) | null; fileName: string }) {
  const desktop = useSyncExternalStore(noSubscription, hasPhone, () => false);
  const setPhoneOpen = usePhone((s) => s.setOpen);
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [round, setRound] = useState(0);
  const [status, setStatus] = useState<{ text: string; kind: "busy" | "ok" | "error" } | null>(null);
  const [reelOpen, setReelOpen] = useState(false);
  const [picked, setPicked] = useState<Blob | null>(null);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<"reel" | "story" | "send" | null>(null);
  /** The video already on the phone, so a second button does not copy it again. */
  const sent = useRef<{ video: Blob; uri: string } | null>(null);

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

  if (!desktop) return null;
  const source = video ?? picked;
  const name = video ? fileName : (pickedName ?? fileName);
  const busy = status?.kind === "busy";
  const ready = !!info?.available;

  /** Copies the video to the phone unless it is there already; returns its gallery address. */
  const ensureSent = async (from: Blob, onLabel: (label: string) => void) => {
    if (sent.current?.video === from) return sent.current.uri;
    const api = phoneBridge();
    if (!api) throw new Error("The phone connection is not available.");
    onLabel("Sending the video to the phone");
    const { uri } = await sendToPhone(api, from, name);
    sent.current = { video: from, uri };
    return uri;
  };

  const act = async (what: "reel" | "story" | "send", from: Blob | null = source) => {
    if (!from && loadVideo) {
      // The export went straight to disk: read it back from where it was saved.
      try {
        from = await loadVideo();
        setPicked(from);
      } catch {
        from = null;
      }
    }
    if (!from) {
      // It could not be read back: ask for the file, then carry on with the same button.
      pending.current = what;
      fileRef.current?.click();
      return;
    }
    if (what === "reel") {
      setStatus(null);
      setReelOpen(true);
      return;
    }
    setStatus({ text: "Sending the video to the phone", kind: "busy" });
    try {
      const uri = await ensureSent(from, () => undefined);
      if (what === "send") {
        setStatus({ text: `Sent. ${name} is the newest video in the phone's gallery.`, kind: "ok" });
        return;
      }
      setPhoneOpen(true);
      await phoneBridge()!.open("story", uri);
      setStatus({ text: "Instagram's Story screen is open in the phone panel. Finish and share there.", kind: "ok" });
    } catch (e) {
      setStatus({ text: clean(e, "The emulator did not answer."), kind: "error" });
    }
  };

  return (
    <div className="space-y-2 rounded-lg border border-sys-gray4 bg-sys-gray5/40 p-2.5" data-instagram-section>
      <p className="text-[12px] font-semibold text-label-2">Instagram</p>
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
          setPicked(file);
          setPickedName(file.name);
          if (what) void act(what, file);
        }}
      />
      <div className="flex flex-col gap-1.5">
        <Button variant="primary" size="sm" className="w-full justify-start" disabled={!ready || !info?.instagram || busy} onClick={() => void act("reel")} data-instagram-reel>
          <Clapperboard size={13} /> Post / Reel
        </Button>
        <Button variant="secondary" size="sm" className="w-full justify-start" disabled={!ready || !info?.instagram || busy} onClick={() => void act("story")} data-instagram-story>
          <PlusCircle size={13} /> Story
        </Button>
        <Button variant="secondary" size="sm" className="w-full justify-start" disabled={!ready || busy} onClick={() => void act("send")} data-instagram-send>
          <Send size={13} /> Send to phone
        </Button>
      </div>
      {!video && !loadVideo && !picked && (
        <p className="rf-read-note flex items-center gap-1.5">
          <FolderOpen size={13} className="shrink-0" />
          This export was saved straight to disk, so the buttons will ask for the saved file.
        </p>
      )}
      {info && !info.available && (
        <p className="rf-read-note" data-instagram-missing>
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
    </div>
  );
}
