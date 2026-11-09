"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Square, X, Plus, KeyRound, Check } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { loadAiSettings, saveAiSettings, listDeepseekModels } from "@/lib/edit/aiHighlights";
import { streamDeepseekChat, type ChatMessage } from "@/lib/chat/deepseekChat";
import { readKept, writeKept } from "@/lib/chat/chatKeep";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

const CHIP_PROMPTS = ["Write a hook for my reel", "Give me 5 title ideas", "Ideas for caption style"];

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(readKept);
  const [settings, setSettings] = useState(loadAiSettings);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const saveKey = async () => {
    const trimmed = keyDraft.trim();
    if (!trimmed || checking) return;
    setChecking(true);
    setKeyError(null);
    try {
      await listDeepseekModels(trimmed, AbortSignal.timeout(20000));
      const next = { ...loadAiSettings(), deepseekKey: trimmed };
      saveAiSettings(next);
      setSettings(next);
      setKeyDraft("");
      setShowKey(false);
      setNotice("DeepSeek key saved. You're connected.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setKeyError(msg === "The API key was rejected." ? "DeepSeek rejected this key. Check it and try again." : `Could not check the key: ${msg}`);
    } finally {
      setChecking(false);
    }
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (busy || !trimmed || !settings.deepseekKey) return;
    setError(null);
    setNotice(null);
    const user: ChatMessage = { role: "user", content: trimmed };
    const assistant: ChatMessage = { role: "assistant", content: "" };
    const old = messages;
    const next = [...old, user, assistant];
    setMessages(next);
    writeKept(next);
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamDeepseekChat({
        apiKey: settings.deepseekKey,
        model: loadAiSettings().deepseekModel,
        messages: [...old, user],
        signal: controller.signal,
        onDelta: (delta) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === "assistant") {
              updated[updated.length - 1] = { ...last, content: last.content + delta };
            }
            writeKept(updated);
            return updated;
          });
        },
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // quiet: keep partial text
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant" && !last.content) updated.pop();
          writeKept(updated);
          return updated;
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const newChat = () => {
    abortRef.current?.abort();
    writeKept([]);
    setMessages([]);
    setError(null);
    setNotice(null);
  };

  const lastAssistant = messages[messages.length - 1];
  const thinking = busy && lastAssistant?.role === "assistant" && !lastAssistant.content;

  return (
    <aside className="rf-panel card flex w-[24rem] shrink-0 flex-col overflow-hidden" aria-label="Chat">
      <div className="flex items-center justify-between border-b border-sys-gray5 px-4 py-3">
        <h2 className="caps rf-panel-title">Chat</h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="iconSm" aria-label="New chat" title="New chat" onClick={newChat}>
            <Plus size={16} />
          </Button>
          <Button variant="ghost" size="iconSm" aria-label="DeepSeek API key" title="DeepSeek API key" onClick={() => setShowKey((v) => !v)}>
            <KeyRound size={16} />
          </Button>
          <Button variant="ghost" size="iconSm" aria-label="Close chat" title="Close chat" onClick={() => useEditor.getState().setChatOpen(false)}>
            <X size={16} />
          </Button>
        </div>
      </div>

      {(!settings.deepseekKey || showKey) && (
        <div className="border-b border-sys-gray5 px-4 py-3">
          <label className="mb-1 block text-[12px] text-white/70">DeepSeek API key</label>
          <Input
            type="password"
            placeholder="sk-…"
            autoComplete="off"
            spellCheck={false}
            aria-label="DeepSeek API key"
            value={keyDraft}
            onChange={(e) => setKeyDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                saveKey();
              }
            }}
          />
          <div className="mt-1.5 flex items-center gap-2">
            <Button variant="primary" size="sm" disabled={checking || !keyDraft.trim()} onClick={saveKey}>
              {checking ? "Checking…" : "Save key"}
            </Button>
            {showKey && settings.deepseekKey && (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setShowKey(false); setKeyDraft(""); setKeyError(null); }}>
                  Cancel
                </Button>
                <Button variant="ghost" size="sm" onClick={() => {
                  const next = { ...loadAiSettings(), deepseekKey: "" };
                  saveAiSettings(next);
                  setSettings(next);
                  setKeyDraft("");
                  setShowKey(false);
                  setNotice(null);
                }}>
                  Remove key
                </Button>
              </>
            )}
          </div>
          {keyError && (
            <p className="mt-1.5 text-[12.5px] text-sys-red" role="alert">
              {keyError}
            </p>
          )}
          <p className="rf-read-note mt-1.5 text-[11px] text-white/50">Stored in this browser only and sent only to api.deepseek.com, billed to your key. Get one at platform.deepseek.com.</p>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {notice && (
          <p className="flex items-center gap-1.5 rounded-lg border border-sys-green/40 bg-sys-green/10 px-2.5 py-1.5 text-[13px] text-sys-green" role="status">
            <Check size={14} />
            {notice}
          </p>
        )}
        {!settings.deepseekKey ? (
          <p className="text-[13px] text-white/50">Add your DeepSeek API key to start.</p>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Sparkles size={28} className="text-white/40" />
            <p className="text-[14px] text-white/70">Ask anything about your reel</p>
            <div className="flex flex-wrap justify-center gap-2">
              {CHIP_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="rounded-full border border-sys-gray4 px-3 py-1.5 text-[12px] text-white/80 hover:bg-sys-gray4"
                  onClick={() => send(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            if (m.role === "user") {
              return (
                <div key={i} className="ml-8 whitespace-pre-wrap break-words rounded-2xl bg-sys-gray4 px-3 py-2 text-[14px]">
                  {m.content}
                </div>
              );
            }
            return (
              <div key={i} className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-white/90">
                {m.content || (thinking && i === messages.length - 1 ? <span className="text-white/50">Thinking…</span> : null)}
              </div>
            );
          })
        )}
      </div>

      {error && (
        <p className="px-4 pb-1 text-[12.5px] text-sys-red" role="alert">
          {error}
        </p>
      )}

      <div className="border-t border-sys-gray5 p-3">
        <div className="rounded-2xl border border-sys-gray4 bg-sys-gray5 p-2.5">
          <textarea
            ref={textareaRef}
            rows={1}
            placeholder="How can I help you today?"
            aria-label="Message"
            className="w-full resize-none bg-transparent text-[14px] text-white outline-none placeholder:text-white/40"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 6 * 20)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(draft);
              }
            }}
          />
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[11px] text-white/50">DeepSeek · {settings.deepseekModel}</span>
            {busy ? (
              <Button variant="primary" size="iconSm" aria-label="Stop" onClick={() => abortRef.current?.abort()}>
                <Square size={14} />
              </Button>
            ) : (
              <Button variant="primary" size="iconSm" aria-label="Send" disabled={!draft.trim() || !settings.deepseekKey} onClick={() => send(draft)}>
                <ArrowUp size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

