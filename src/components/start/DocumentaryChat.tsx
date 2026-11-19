"use client";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { ArrowUp, KeyRound, Loader2, MessageCircle, Square } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { askAboutFilm, chatBody, filmBrief, momentNote, sceneLabel, type DocChatMessage } from "@/lib/documentary/chat";
import type { DocScript } from "@/lib/documentary/script";
import type { FilmTimeline } from "@/lib/documentary/timeline";
import { formatClock } from "@/lib/documentary/transcript";

const SUGGESTIONS = ["What does this mean?", "Give me an example", "Explain it more simply"];

/**
 * The chat beside the film. It knows the whole documentary and the original transcript, and
 * every question carries where the viewer is in the film: asking pauses the film, so "what does
 * this mean?" is about the scene on screen. Uses the visitor's own DeepSeek key.
 */
export function DocumentaryChat({
  script,
  timeline,
  transcriptText,
  videoRef,
  apiKey,
  model,
  onKey,
}: {
  script: DocScript;
  timeline: FilmTimeline;
  transcriptText: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  apiKey: string;
  model: string;
  /** Saves a new DeepSeek key (into the site's AI settings, in this browser). */
  onKey: (key: string) => void;
}) {
  const [messages, setMessages] = useState<DocChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Where the film is now, for the line above the box; refreshed as it plays. */
  const [now, setNow] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const brief = useMemo(() => filmBrief(script, timeline, transcriptText), [script, timeline, transcriptText]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const update = () => setNow(v.currentTime);
    v.addEventListener("timeupdate", update);
    v.addEventListener("seeked", update);
    return () => {
      v.removeEventListener("timeupdate", update);
      v.removeEventListener("seeked", update);
    };
  }, [videoRef]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy || !apiKey) return;
    const video = videoRef.current;
    const at = video?.currentTime ?? 0;
    // Reading an answer while the film plays on would lose the moment; asking holds it.
    video?.pause();
    const next: DocChatMessage[] = [...messages, { role: "user", content: question, at, paused: true }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setDraft("");
    setError(null);
    setBusy(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const body = chatBody(model, brief, next, (m) => momentNote(script, timeline, m.at ?? 0, m.paused ?? false));
      await askAboutFilm({
        apiKey,
        body,
        signal: ctl.signal,
        onDelta: (d) => setMessages((old) => old.map((m, i) => (i === old.length - 1 ? { ...m, content: m.content + d } : m))),
      });
    } catch (e) {
      if (!ctl.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
        // Drop the empty answer slot; keep the question so it can be asked again.
        setMessages((old) => (old[old.length - 1]?.content === "" ? old.slice(0, -1) : old));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex h-[26rem] min-h-0 flex-col rounded-xl border border-sys-gray4 bg-sys-gray5/40 lg:h-full lg:min-h-[24rem]" aria-label="Ask about the documentary" data-documentary-chat>
      <h4 className="flex items-center gap-2 border-b border-sys-gray4 px-3 py-2 text-[13px] font-semibold text-white">
        <MessageCircle size={15} aria-hidden /> Ask about this film
      </h4>

      <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[13px]" aria-live="polite" data-documentary-chat-list>
        {messages.length === 0 && (
          <p className="text-label-3">Pause anywhere and ask. It knows the whole film and where you are in it, so &ldquo;what does this mean?&rdquo; is about the scene on screen.</p>
        )}
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="ml-6 space-y-0.5">
              <p className="text-right text-[11px] text-label-3">
                {formatClock(m.at ?? 0)} · {sceneLabel(script, timeline, m.at ?? 0)}
              </p>
              <p className="rounded-xl rounded-br-sm bg-sys-blue px-3 py-2 text-white [overflow-wrap:anywhere]">{m.content}</p>
            </div>
          ) : (
            <p key={i} className="mr-6 whitespace-pre-wrap rounded-xl rounded-bl-sm bg-sys-gray4 px-3 py-2 text-label-1 [overflow-wrap:anywhere]" data-documentary-chat-answer>
              {m.content || <Loader2 size={14} className="animate-spin text-label-3" aria-label="Thinking" />}
            </p>
          ),
        )}
        {error && (
          <p className="text-sys-red" role="alert" data-documentary-chat-error>
            {error}
          </p>
        )}
      </div>

      {apiKey ? (
        <div className="space-y-2 border-t border-sys-gray4 p-3">
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" onClick={() => void send(s)} disabled={busy} className="rounded-full bg-sys-gray4 px-2.5 py-1 text-[12px] text-label-1 hover:bg-sys-gray3 disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          )}
          <p className="truncate text-[11px] text-label-3" data-documentary-chat-moment>
            Asking about {formatClock(now)} · {sceneLabel(script, timeline, now)}
          </p>
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              rows={2}
              placeholder="Ask about what's on screen…"
              aria-label="Your question"
              className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-2 text-[13px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50"
              data-documentary-chat-input
            />
            {busy ? (
              <Button type="button" variant="outline" size="icon" onClick={() => abortRef.current?.abort()} aria-label="Stop the answer">
                <Square size={14} />
              </Button>
            ) : (
              <Button type="submit" variant="primary" size="icon" disabled={!draft.trim()} aria-label="Send" data-documentary-chat-send>
                <ArrowUp size={16} />
              </Button>
            )}
          </form>
        </div>
      ) : (
        <form
          className="space-y-2 border-t border-sys-gray4 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (keyDraft.trim()) onKey(keyDraft.trim());
          }}
        >
          <p className="flex items-center gap-1.5 text-[12px] text-label-2">
            <KeyRound size={13} aria-hidden /> Add your DeepSeek key to ask questions. It stays in this browser.
          </p>
          <div className="flex gap-2">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder="sk-…"
              spellCheck={false}
              autoComplete="off"
              aria-label="DeepSeek API key"
              className="h-8 min-w-0 flex-1 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 text-[13px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50"
            />
            <Button type="submit" variant="primary" size="sm" disabled={!keyDraft.trim()}>
              Save
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
