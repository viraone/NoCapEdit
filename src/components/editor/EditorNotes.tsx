"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, ExternalLink, NotebookPen, RefreshCw, Settings, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useEditor } from "@/store/editorStore";
import {
  NOTES_APPS_SCRIPT,
  formatNoteDate,
  isScriptUrl,
  loadCachedNotes,
  loadNotesOpen,
  loadNotesUrl,
  newNoteId,
  pushNote,
  saveCachedNotes,
  saveNotesOpen,
  saveNotesUrl,
  syncNotes,
  type Note,
} from "@/lib/notes/sheetNotes";

const ICON = "rounded p-0.5 text-label-3 hover:bg-sys-gray4 hover:text-white";
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Notes beside the chat. Each one becomes a row (Date, Note) in the owner's Google Sheet. */
export function EditorNotes() {
  const ready = useEditor((s) => !!s.project);
  const [open, setOpen] = useState(() => loadNotesOpen());
  const [url, setUrl] = useState(() => loadNotesUrl());
  const [notes, setNotes] = useState<Note[]>(() => loadCachedNotes());
  const [sheetUrl, setSheetUrl] = useState("");
  const [setup, setSetup] = useState(() => !loadNotesUrl());
  const [draft, setDraft] = useState("");
  const [urlDraft, setUrlDraft] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [round, setRound] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Reads the sheet once the panel is connected, then sends anything the sheet does not have yet.
  useEffect(() => {
    if (!url) return;
    let live = true;
    syncNotes(url, (next) => {
      if (live) setNotes(next);
    })
      .then((link) => {
        if (!live) return;
        setSheetUrl(link);
        setError("");
      })
      .catch((e: unknown) => {
        if (live) setError(message(e));
      });
    return () => {
      live = false;
    };
  }, [url, round]);

  // The newest note is at the bottom, so the list follows it.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [notes.length]);

  if (!ready) return null;

  const show = (on: boolean) => {
    saveNotesOpen(on);
    setOpen(on);
  };

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    const note: Note = { id: newNoteId(), date: new Date().toISOString(), text, saved: false };
    const next = [...loadCachedNotes(), note];
    saveCachedNotes(next);
    setNotes(next);
    if (!url) return;
    try {
      setNotes(await pushNote(url, note.id));
      setError("");
    } catch (e) {
      setError(message(e));
    }
  };

  const connect = () => {
    const link = urlDraft.trim();
    if (!isScriptUrl(link)) {
      setError("That is not a Web app link. It starts with https://script.google.com/macros/s/ and ends with /exec.");
      return;
    }
    saveNotesUrl(link);
    setUrl(link);
    setUrlDraft("");
    setSetup(false);
    setError("");
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(NOTES_APPS_SCRIPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      setError(message(e));
    }
  };

  const waiting = notes.filter((n) => !n.saved).length;

  return (
    <>
      {/* Hidden, not unmounted, so closing the column keeps a half-typed note. */}
      <aside className={open ? "flex w-[18rem] shrink-0 flex-col" : "hidden"} data-editor-notes>
        <section className="flex h-full min-h-0 flex-col rounded-xl border border-sys-gray4 bg-sys-gray5/40" aria-label="Notes">
          <h4 className="flex items-center gap-2 border-b border-sys-gray4 px-3 py-2 text-[13px] font-semibold text-white">
            <NotebookPen size={15} aria-hidden /> Notes
            <span className="ml-auto flex items-center gap-1">
              {sheetUrl && (
                <a href={sheetUrl} target="_blank" rel="noreferrer" className={ICON} aria-label="Open the Google Sheet" title="Open the Google Sheet" data-editor-notes-sheet>
                  <ExternalLink size={14} />
                </a>
              )}
              {url && (
                <button type="button" onClick={() => setRound((r) => r + 1)} className={ICON} aria-label="Read the sheet again" title="Read the sheet again" data-editor-notes-refresh>
                  <RefreshCw size={14} />
                </button>
              )}
              <button type="button" onClick={() => setSetup((s) => !s)} className={ICON} aria-label="Google Sheet connection" title="Google Sheet connection" data-editor-notes-settings>
                <Settings size={14} />
              </button>
              <button type="button" onClick={() => show(false)} className={ICON} aria-label="Hide the notes" title="Hide the notes" data-editor-notes-close>
                <X size={14} />
              </button>
            </span>
          </h4>

          {setup && (
            <div className="space-y-2 border-b border-sys-gray4 px-3 py-3 text-[12px] text-label-2" data-editor-notes-setup>
              <p className="font-semibold text-white">{url ? "Connected to your Google Sheet" : "Connect your Google Sheet"}</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Open the sheet in Google Sheets, then Extensions, Apps Script.</li>
                <li>
                  <button type="button" onClick={() => void copyScript()} className="inline-flex items-center gap-1 font-semibold text-sys-blue hover:underline" data-editor-notes-copy>
                    {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy the script"}
                  </button>{" "}
                  and paste it over what is there. Save.
                </li>
                <li>Deploy, New deployment, Web app. Execute as: Me. Who has access: Anyone. Approve it.</li>
                <li>Paste the Web app link below.</li>
              </ol>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  connect();
                }}
                className="flex items-center gap-2"
              >
                <input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://script.google.com/macros/s/…/exec"
                  aria-label="Web app link"
                  className="min-w-0 flex-1 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-1.5 text-[12px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none"
                  data-editor-notes-url
                />
                <Button type="submit" variant="primary" size="sm" disabled={!urlDraft.trim()} data-editor-notes-connect>
                  Connect
                </Button>
              </form>
              <p className="text-label-3">The link stays in this browser. Anyone who has it can add notes to the sheet, so keep it to yourself.</p>
            </div>
          )}

          <div ref={listRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[13px]" aria-live="polite" data-editor-notes-list>
            {notes.length === 0 && <p className="text-label-3">Type a note below. Each one becomes a row in your Google Sheet, with the date filled in for you.</p>}
            {notes.map((n) => (
              <div key={n.id} className="space-y-0.5" data-editor-note>
                <p className="text-[11px] text-label-3">
                  {formatNoteDate(n.date)}
                  {!n.saved && " · not in the sheet yet"}
                </p>
                <p className="whitespace-pre-wrap rounded-xl bg-sys-gray4 px-3 py-2 text-label-1 [overflow-wrap:anywhere]">{n.text}</p>
              </div>
            ))}
            {error && (
              <p className="text-sys-red" role="alert" data-editor-notes-error>
                {error}
              </p>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
            className="space-y-1.5 border-t border-sys-gray4 px-3 py-3"
          >
            {waiting > 0 && url && (
              <p className="text-[11px] text-label-3">
                {waiting} not in the sheet yet.{" "}
                <button type="button" onClick={() => setRound((r) => r + 1)} className="underline hover:text-white" data-editor-notes-retry>
                  Try again
                </button>
              </p>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void add();
                  }
                }}
                rows={2}
                placeholder="Write a note…"
                aria-label="Your note"
                className="min-h-[2.5rem] flex-1 resize-none rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-2 text-[13px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50"
                data-editor-notes-input
              />
              <Button type="submit" variant="primary" size="icon" disabled={!draft.trim()} aria-label="Add note" data-editor-notes-add>
                <ArrowUp size={16} />
              </Button>
            </div>
          </form>
        </section>
      </aside>
      {!open && (
        <button type="button" onClick={() => show(true)} className="card order-last flex h-10 w-10 shrink-0 items-center justify-center self-start text-label-2 hover:text-white" aria-label="Notes" title="Notes" data-editor-notes-open>
          <NotebookPen size={18} />
        </button>
      )}
    </>
  );
}
