"use client";
import { useEffect, useRef, useState } from "react";
import { Anchor, Merge, Play, Scissors, Trash2 } from "lucide-react";
import type { CaptionCue } from "@/lib/models/project";
import { cx } from "@/lib/utils/cx";
import { inputClass } from "@/components/ui/Field";
import { NumberInput } from "@/components/ui/NumberInput";

function CueText({ value, onCommit, placeholder, className, focusNonce }: { value: string; onCommit: (v: string) => void; placeholder?: string; className?: string; focusNonce?: number }) {
  const [text, setText] = useState(value);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setText(value);
  }
  const ref = useRef<HTMLInputElement>(null);
  // A canvas double-click asks for the caret here with the text selected.
  useEffect(() => {
    if (!focusNonce) return;
    ref.current?.focus();
    ref.current?.select();
  }, [focusNonce]);
  return (
    <input
      ref={ref}
      data-content-editor="cue"
      className={cx(inputClass, "h-7 text-[13px]", className)}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

export interface CueRowProps {
  cue: CaptionCue;
  /** True for the last cue in the list, where Merge with next has nothing to merge into. */
  last: boolean;
  active: boolean;
  selected: boolean;
  showTranslated: boolean;
  /** Set when a canvas double-click asks for this cue's text box. */
  focusNonce?: number;
  /** The global caption position, used when a cue is detached from it. */
  anchorX: number;
  anchorY: number;
  onSelect: () => void;
  onSeek: (seconds: number) => void;
  onEdit: (fn: (c: CaptionCue) => void) => void;
  onSplit: () => void;
  onMerge: () => void;
  onRemove: () => void;
}

/** One row in the Cues list: timings, split / merge / anchor / delete, and the text. */
export function CueRow({ cue, last, active, selected, showTranslated, focusNonce, anchorX, anchorY, onSelect, onSeek, onEdit, onSplit, onMerge, onRemove }: CueRowProps) {
  return (
    <div
      data-cue={cue.id}
      className={cx("rounded-md border px-2 py-1.5", active ? "border-sys-blue bg-sys-blue/10" : "border-sys-gray4", selected && "ring-1 ring-sys-blue")}
      onClick={onSelect}
    >
      <div className="mb-1 flex items-center gap-1 text-[10px] tabular-nums text-label-2">
        <button type="button" className="rounded p-0.5 hover:bg-sys-gray4 hover:text-white" onClick={(e) => (e.stopPropagation(), onSeek(cue.start))} title="Jump to cue">
          <Play size={10} />
        </button>
        <NumberInput value={cue.start} min={0} max={cue.end - 0.1} className="h-5 w-16 px-1 text-[10px]" onCommit={(v) => onEdit((c) => void (c.start = v))} />
        <span>→</span>
        <NumberInput value={cue.end} min={cue.start + 0.1} className="h-5 w-16 px-1 text-[10px]" onCommit={(v) => onEdit((c) => void (c.end = v))} />
        <span className="ml-auto flex items-center">
          <button type="button" className="rounded p-0.5 hover:bg-sys-gray4 hover:text-white" title="Split in the middle" onClick={(e) => (e.stopPropagation(), onSplit())}>
            <Scissors size={11} />
          </button>
          <button type="button" className="rounded p-0.5 hover:bg-sys-gray4 hover:text-white disabled:opacity-30" title="Merge with next" disabled={last} onClick={(e) => (e.stopPropagation(), onMerge())}>
            <Merge size={11} />
          </button>
          <button
            type="button"
            className={cx("rounded p-0.5 hover:bg-sys-gray4 hover:text-white", cue.anchor && "text-sys-yellow")}
            title={cue.anchor ? "Detached: click to follow the global position again" : "Detach: give this cue its own position (or Alt-drag it on the preview)"}
            onClick={(e) => (e.stopPropagation(), onEdit((c) => void (c.anchor = c.anchor ? null : { x: anchorX, y: anchorY })))}
          >
            <Anchor size={11} />
          </button>
          <button type="button" className="rounded p-0.5 text-sys-red hover:bg-sys-gray4" title="Delete" onClick={(e) => (e.stopPropagation(), onRemove())}>
            <Trash2 size={11} />
          </button>
        </span>
      </div>
      <CueText value={cue.text} onCommit={(v) => onEdit((c) => void (c.text = v))} focusNonce={focusNonce} />
      {showTranslated && <CueText className="mt-1 text-label-2" value={cue.translatedText ?? ""} placeholder="Translation" onCommit={(v) => onEdit((c) => void (c.translatedText = v))} />}
    </div>
  );
}
