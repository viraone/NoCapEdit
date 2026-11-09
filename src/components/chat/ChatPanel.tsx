"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, ArrowUp, Square, X, Plus, KeyRound, Check, Undo2, Loader2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { loadAiSettings, saveAiSettings, listDeepseekModels } from "@/lib/edit/aiHighlights";
import { runAgent, streamAgentTurn } from "@/lib/chat/deepseekAgent";
import type { ChatMessage } from "@/lib/chat/deepseekChat";
import type { AgentAction, ApiMessage, ToolResult } from "@/lib/chat/toolTypes";
import { EDIT_TOOLS, runEditTool, toolNeedsRipple } from "@/lib/chat/editTools";
import { describeProject } from "@/lib/chat/projectContext";
import { AGENT_SYSTEM_PROMPT } from "@/lib/chat/agentPrompt";
import { transcribeProject } from "./transcribeForChat";
import { readKept, writeKept } from "@/lib/chat/chatKeep";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Field";

const CHIP_PROMPTS = ["Transcribe this video", "Cut out the ums and uhs", "Write a hook for my reel"];

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
  const [status, setStatus] = useState<string | null>(null);
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
      const history: ApiMessage[] = [...old, user].flatMap((m): ApiMessage[] => {
        if (m.role === "system") return [];
        if (m.role === "assistant" && !m.content) return [];
        if (m.role === "assistant" && m.actions) {
          const labels = m.actions.filter((a) => a.ok).map((a) => a.label);
          return [{ role: "assistant", content: labels.length ? `${m.content}\n(Edits made: ${labels.join("; ")})` : m.content }];
        }
        return [{ role: m.role, content: m.content }];
      });
      const updateLast = (change: (last: ChatMessage) => ChatMessage) =>
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant") updated[updated.length - 1] = change(last);
          writeKept(updated);
          return updated;
        });
      const callModel = (msgs: ApiMessage[]) => {
        const project = useEditor.getState().project;
        return streamAgentTurn({
          apiKey: settings.deepseekKey,
          model: loadAiSettings().deepseekModel,
          system: AGENT_SYSTEM_PROMPT + "\n\nCurrent project:\n" + (project ? describeProject(project, { playhead: useEditor.getState().currentTime }) : "No project is open."),
          messages: msgs,
          tools: EDIT_TOOLS,
          signal: controller.signal,
          onText: (delta) => updateLast((last) => ({ ...last, content: last.content + delta })),
        });
      };
      const runTool = async (name: string, args: unknown): Promise<ToolResult> => {
        if (name === "transcribe") {
          setStatus("Transcribing. This takes a few minutes the first time.");
          try {
            return await transcribeProject(controller.signal, (p) => setStatus("Transcribing: " + p.message));
          } finally {
            setStatus(null);
          }
        }
        let result: ToolResult = { ok: false, message: "No project is open." };
        useEditor.getState().update(
          (p) => {
            result = runEditTool(p, name, args);
          },
          { ripple: toolNeedsRipple(name) },
        );
        return result;
      };
      const { actions, hitLimit } = await runAgent({
        history,
        callModel,
        runTool,
        signal: controller.signal,
        onRound: (round) => {
          if (round > 0) updateLast((last) => (last.content && !last.content.endsWith("\n\n") ? { ...last, content: last.content + "\n\n" } : last));
        },
        onAction: (a: AgentAction) => updateLast((last) => ({ ...last, actions: [...(last.actions ?? []), a] })),
      });
      if (!actions.length && !hitLimit) return;
      updateLast((last) => {
        let content = last.content;
        if (!content.trim() && actions.length > 0) content = "Done.";
        if (hitLimit) content += "\n\n(I stopped after 8 steps. Ask me to continue if there is more to do.)";
        return { ...last, content };
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // quiet: keep partial text
      } else {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === "assistant" && !last.content && !last.actions?.length) updated.pop();
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
  const thinking = busy && !status && lastAssistant?.role === "assistant" && !lastAssistant.content;

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
          <p className="rf-read-note mt-1.5 text-[11px] text-white/50">Stored in this browser only and sent only to api.deepseek.com, billed to your key. Get one at platform.deepseek.com. The video itself never leaves this device; DeepSeek sees your clip list and transcript so it can edit.</p>
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
            <p className="text-[14px] text-white/70">Tell me what to change in your reel, or ask anything</p>
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
            <p className="text-[11px] text-white/40">DeepSeek sees your clip list and transcript, never the video itself.</p>
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
            const isLast = i === messages.length - 1;
            const okCount = m.actions?.filter((a) => a.ok).length ?? 0;
            return (
              <div key={i} className="space-y-1.5">
                <div className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-white/90">
                  {m.content || (thinking && isLast ? <span className="text-white/50">Thinking…</span> : null)}
                </div>
                {m.actions && m.actions.length > 0 && (
                  <div className="space-y-1 rounded-lg border border-sys-gray4 bg-sys-gray5/60 px-2.5 py-1.5">
                    {m.actions.map((a, j) => (
                      <div key={j} className="flex items-center gap-1.5">
                        {a.ok ? <Check size={12} className="shrink-0 text-sys-green" /> : <X size={12} className="shrink-0 text-sys-red" />}
                        <span className="text-[12.5px] text-white/80">{a.label}</span>
                      </div>
                    ))}
                  </div>
                )}
                {isLast && okCount > 0 && !m.undone && !busy && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => {
                      for (let j = 0; j < okCount; j++) useEditor.getState().undo();
                      setMessages((prev) => {
                        const updated = [...prev];
                        const last = updated[updated.length - 1];
                        if (last && last.role === "assistant") updated[updated.length - 1] = { ...last, undone: true };
                        writeKept(updated);
                        return updated;
                      });
                    }}
                  >
                    <Undo2 size={12} />
                    Undo these edits
                  </Button>
                )}
                {isLast && m.undone && <p className="text-[12px] text-white/50">Edits undone.</p>}
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

      {status && (
        <div className="flex items-center gap-1.5 px-4 pb-2 text-[12.5px] text-white/60">
          <Loader2 size={13} className="animate-spin" />
          {status}
        </div>
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

