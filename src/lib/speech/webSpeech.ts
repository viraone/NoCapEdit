/**
 * Web Speech API fallback. Browsers only feed the recogniser from the
 * microphone (or, in newer Chrome builds, a MediaStreamTrack), so this plays
 * the project and time-stamps whatever the recogniser hears. Accuracy of the
 * timings is approximate compared with Whisper.
 */
import type { WordTiming } from "@/lib/models/project";

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
}

function getRecognitionCtor(): (new () => RecognitionLike) | null {
  const w = globalThis as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isWebSpeechAvailable(): boolean {
  return getRecognitionCtor() !== null;
}

export interface LiveDictationOptions {
  lang: string;
  /** Current project time, used to timestamp results. */
  getTime: () => number;
  onWords: (words: WordTiming[]) => void;
  onInterim?: (text: string) => void;
  onEnd: (error?: string) => void;
  /** Optional audio track to feed instead of the microphone (Chrome only). */
  audioTrack?: MediaStreamTrack | null;
}

export interface LiveDictationController {
  stop(): void;
}

export function startLiveDictation(opts: LiveDictationOptions): LiveDictationController {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    opts.onEnd("Web Speech API is not available in this browser.");
    return { stop: () => undefined };
  }
  let stopped = false;
  let recognition: RecognitionLike | null = null;
  const firstSeen = new Map<number, number>();

  const begin = () => {
    recognition = new Ctor();
    recognition.lang = opts.lang === "auto" ? navigator.language : opts.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const now = opts.getTime();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0].transcript.trim();
        if (!firstSeen.has(i)) firstSeen.set(i, now);
        if (!result.isFinal) {
          opts.onInterim?.(transcript);
          continue;
        }
        const tokens = transcript.split(/\s+/).filter(Boolean);
        if (!tokens.length) continue;
        const end = now;
        const start = Math.max(0, Math.min(firstSeen.get(i) ?? end - tokens.length * 0.35, end - tokens.length * 0.2));
        const per = (end - start) / tokens.length;
        opts.onWords(tokens.map((text, k) => ({ text, start: start + k * per, end: start + (k + 1) * per })));
      }
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      stopped = true;
      opts.onEnd(e.error === "not-allowed" ? "Microphone access was denied." : `Speech recognition error: ${e.error}`);
    };
    recognition.onend = () => {
      if (stopped) return;
      // Chrome ends sessions after silence; keep listening until stopped.
      firstSeen.clear();
      try {
        begin();
      } catch {
        opts.onEnd();
      }
    };
    try {
      if (opts.audioTrack) recognition.start(opts.audioTrack);
      else recognition.start();
    } catch {
      recognition.start();
    }
  };
  begin();

  return {
    stop() {
      stopped = true;
      try {
        recognition?.stop();
      } catch {
        /* ignore */
      }
      opts.onEnd();
    },
  };
}
