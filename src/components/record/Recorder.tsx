"use client";
/**
 * In-browser screen / camera recorder (getDisplayMedia, getUserMedia,
 * MediaRecorder). The recording becomes a normal imported clip.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Monitor, Camera, Mic, Circle, Square } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Tile, TileGrid } from "@/components/ui/Tile";
import { cx } from "@/lib/utils/cx";

type Mode = "screen" | "camera" | "screen-mic";

function pickMimeType(): string | undefined {
  const candidates = ["video/mp4;codecs=avc1,mp4a.40.2", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
  return candidates.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
}

export function isRecordingSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices && typeof MediaRecorder !== "undefined";
}

const noSubscribe = () => () => {};

/** Client-only capability: the server snapshot is false, so pre-rendered HTML matches the first client render. */
export function useRecordingSupported(): boolean {
  return useSyncExternalStore(noSubscribe, isRecordingSupported, () => false);
}

export function Recorder({ open, onClose, onRecorded }: { open: boolean; onClose: () => void; onRecorded: (file: File) => void }) {
  const [mode, setMode] = useState<Mode>("screen");
  const [status, setStatus] = useState<"idle" | "preparing" | "recording" | "stopping">("idle");
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** Every raw capture stream of the current attempt (camera, screen, mic); the recorded stream can be a mix of them. */
  const sourcesRef = useRef<MediaStream[]>([]);
  /** Bumped by cleanup(): a start() whose permission prompt resolves after that is stale and must release what it got. */
  const attemptRef = useRef(0);

  const cleanup = () => {
    attemptRef.current++;
    sourcesRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    sourcesRef.current = [];
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  // A dialog closed mid-preparing or after an error reopens clean.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setStatus("idle");
      setSeconds(0);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) cleanup();
    return cleanup;
  }, [open]);

  const start = async () => {
    setError(null);
    setStatus("preparing");
    const attempt = attemptRef.current;
    // Records a stream the moment it arrives, so cleanup() can always stop it.
    // Returns false when the dialog was closed (or restarted) while we waited.
    const keep = (s: MediaStream) => {
      if (attemptRef.current !== attempt) {
        s.getTracks().forEach((t) => t.stop());
        return false;
      }
      sourcesRef.current.push(s);
      return true;
    };
    try {
      let stream: MediaStream;
      if (mode === "camera") {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } }, audio: true });
        if (!keep(stream)) return;
      } else {
        const display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: true });
        if (!keep(display)) return;
        if (mode === "screen-mic") {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          if (!keep(mic)) return;
          const ctx = new AudioContext();
          audioCtxRef.current = ctx;
          const dest = ctx.createMediaStreamDestination();
          if (display.getAudioTracks().length) ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
          ctx.createMediaStreamSource(mic).connect(dest);
          stream = new MediaStream([...display.getVideoTracks(), ...dest.stream.getAudioTracks()]);
        } else stream = display;
        display.getVideoTracks()[0]?.addEventListener("ended", () => stop());
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => undefined);
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      recorder.onstop = () => {
        const type = recorder.mimeType || "video/webm";
        const ext = type.includes("mp4") ? "mp4" : "webm";
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "-");
        const file = new File(chunksRef.current, `Recording ${stamp}.${ext}`, { type });
        cleanup();
        setStatus("idle");
        setSeconds(0);
        if (file.size > 0) onRecorded(file);
        else setError("The recording was empty.");
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setStatus("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch (e) {
      // A prompt answered after the dialog closed is not this dialog's error.
      if (attemptRef.current !== attempt) return;
      cleanup();
      setStatus("idle");
      setError(e instanceof Error ? (e.name === "NotAllowedError" ? "Permission was denied." : e.message) : String(e));
    }
  };

  const stop = () => {
    const r = recorderRef.current;
    if (!r || r.state === "inactive") return;
    setStatus("stopping");
    r.stop();
  };

  const mm = Math.floor(seconds / 60);
  const ss = String(seconds % 60).padStart(2, "0");

  return (
    <Modal open={open} onClose={() => (status === "recording" ? undefined : onClose())} title="Record">
      <div className="space-y-3">
        <TileGrid cols={3}>
          <Tile icon={<Monitor size={16} />} label="Screen" active={mode === "screen"} onClick={() => setMode("screen")} disabled={status !== "idle"} />
          <Tile icon={<Camera size={16} />} label="Camera" active={mode === "camera"} onClick={() => setMode("camera")} disabled={status !== "idle"} />
          <Tile icon={<Mic size={16} />} label="Screen + mic" active={mode === "screen-mic"} onClick={() => setMode("screen-mic")} disabled={status !== "idle"} />
        </TileGrid>
        <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="h-full w-full object-contain" />
          {status === "recording" && (
            <span className="absolute left-2 top-2 flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-[12px] font-semibold text-white">
              <span className="h-2 w-2 animate-pulse rounded-full bg-sys-red" /> REC {mm}:{ss}
            </span>
          )}
          {status === "idle" && <p className="absolute inset-0 flex items-center justify-center text-[12px] text-label-2">Choose a source, then press Record.</p>}
        </div>
        {error && <p className="text-[11px] text-sys-red">{error}</p>}
        <div className="flex items-center justify-between">
          <p className="text-[11px] text-label-3">Recordings stay on this device and land in your clips.</p>
          {status === "recording" || status === "stopping" ? (
            <Button variant="danger" onClick={stop} disabled={status === "stopping"}>
              <Square size={14} /> Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={start} disabled={status !== "idle" || !isRecordingSupported()} className={cx(status === "preparing" && "opacity-60")}>
              <Circle size={14} fill="currentColor" /> Record
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
