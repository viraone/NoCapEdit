"use client";
import { useState } from "react";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

/** Shorter than this is too little for a documentary. */
export const MIN_PASTED_CHARS = 200;

/**
 * Turn any page into a documentary: the visitor copies its text (select all, copy) and pastes it here.
 * Nothing is fetched; a page behind a login works because the visitor does the copying.
 */
export function PasteTextDialog({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (title: string, text: string) => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const length = text.trim().length;
  const ready = length >= MIN_PASTED_CHARS;
  return (
    <Modal open={open} onClose={onClose} title="Make a documentary from text" width="max-w-2xl">
      <form
        className="space-y-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onUse(title, text);
        }}
        data-paste-text
      >
        <p className="text-sm text-label-2">Open the page, select all (Cmd+A), copy (Cmd+C), and paste it below. It works for lessons, articles and notes, including pages behind a login. The text stays in this browser until you pick an AI writer.</p>
        <div className="space-y-1">
          <label htmlFor="paste-title" className="text-[13px] text-label-2">
            Title (optional)
          </label>
          <input id="paste-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Recognize the value of Google Search ads" className="h-9 w-full rounded-lg border border-sys-gray4 bg-sys-gray5 px-3 text-sm text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50" data-paste-title />
        </div>
        <div className="space-y-1">
          <label htmlFor="paste-text" className="text-[13px] text-label-2">
            Text
          </label>
          <textarea id="paste-text" value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder="Paste the page text here" className="w-full resize-y rounded-lg border border-sys-gray4 bg-sys-gray5 px-3 py-2 text-[13px] leading-relaxed text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50" data-paste-body />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-label-3" data-paste-count>
            {length === 0 ? "Nothing pasted yet" : ready ? `${length.toLocaleString()} characters` : `${length.toLocaleString()} characters, a little more is needed (at least ${MIN_PASTED_CHARS})`}
          </span>
          <Button type="submit" variant="primary" size="md" disabled={!ready} data-paste-use>
            <Clapperboard size={15} /> Continue
          </Button>
        </div>
      </form>
    </Modal>
  );
}
