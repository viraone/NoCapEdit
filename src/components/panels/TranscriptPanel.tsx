"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Trash2, Undo2, Captions } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useProject } from "./shared";
import { applyRemovals } from "@/lib/edit/magicCut";
import { activeWordIndex, flattenTranscript, groupParagraphs, rangeForWords } from "@/lib/edit/transcriptEdit";
import { formatTime } from "@/lib/utils/time";
import { cx } from "@/lib/utils/cx";
import { PanelHeader, PanelSection, EmptyState } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

const SPEAKER_COLORS = ["#0a84ff", "#ff9f0a", "#30d158", "#bf5af2", "#ff375f", "#64d2ff"];

/**
 * Edit the video by editing its words: click a word to jump there, drag (or
 * Shift+click) to select, Delete to cut those words out of the picture. The
 * cut is the same ripple Magic Cut uses, so captions, text, stickers and
 * voice-overs stay on the moment they belong to, and Undo brings it all back.
 */
export function TranscriptPanel() {
  const project = useProject();
  const update = useEditor((s) => s.update);
  const seek = useEditor((s) => s.seek);
  const setTool = useEditor((s) => s.setTool);
  const setNotice = useEditor((s) => s.setNotice);
  const canUndo = useEditor((s) => s.past.length > 0);

  const words = useMemo(() => flattenTranscript(project.cues), [project.cues]);
  const paragraphs = useMemo(() => groupParagraphs(words), [words]);
  // Re-renders only when the spoken word changes, not on every playback frame.
  const active = useEditor((s) => activeWordIndex(words, s.currentTime));

  const [sel, setSel] = useState<{ anchor: number; focus: number } | null>(null);
  const dragging = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  // The words changed under the selection (an edit, an undo): the indexes no longer mean the same words.
  const [seenWords, setSeenWords] = useState(words);
  if (seenWords !== words) {
    setSeenWords(words);
    setSel(null);
  }

  useEffect(() => {
    const stop = () => (dragging.current = false);
    window.addEventListener("mouseup", stop);
    return () => window.removeEventListener("mouseup", stop);
  }, []);

  // Follow the speech while it plays or is scrubbed, unless the user is selecting.
  useEffect(() => {
    if (active < 0 || dragging.current) return;
    listRef.current?.querySelector(`[data-w="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const lo = sel ? Math.min(sel.anchor, sel.focus) : -1;
  const hi = sel ? Math.max(sel.anchor, sel.focus) : -1;
  const range = sel ? rangeForWords(words, lo, hi) : null;
  const count = sel ? hi - lo + 1 : 0;

  const remove = () => {
    if (!range) return;
    let removed = 0;
    update((p) => void (removed = applyRemovals(p, [range]).removedSeconds));
    setSel(null);
    const quote = (range.label ?? "").length > 40 ? `${(range.label ?? "").slice(0, 38)}…` : range.label;
    setNotice(`Cut “${quote}” (${removed.toFixed(1)} s). Undo brings it back.`);
  };

  const onWordDown = (e: React.MouseEvent, i: number) => {
    if (e.button !== 0) return;
    listRef.current?.focus({ preventScroll: true });
    if (e.shiftKey && sel) setSel({ anchor: sel.anchor, focus: i });
    else {
      dragging.current = true;
      setSel({ anchor: i, focus: i });
      seek(words[i].start);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      // The window handler would delete the selected clip or caption instead.
      e.preventDefault();
      e.stopPropagation();
      remove();
    } else if (e.key === "Escape" && sel) {
      e.stopPropagation();
      setSel(null);
    }
  };

  if (!words.length) {
    return (
      <>
        <PanelHeader title="Transcript" />
        <PanelSection>
          <EmptyState
            icon={<Captions size={22} />}
            title="No words to edit yet"
            description="Generate captions first. Every word of them shows up here, ready to cut out by selecting it."
            action={<Button size="sm" variant="secondary" onClick={() => setTool("subtitles")}>Go to Subtitles</Button>}
          />
        </PanelSection>
      </>
    );
  }

  return (
    <>
      <PanelHeader
        title="Transcript"
        meta={`${words.length} words`}
        body={
          <p className="rf-read-note">
            Click a word to jump to it. <b>Drag</b> or <b>Shift+click</b> to select, then press <b>Delete</b>. The video closes the gap.
          </p>
        }
        actions={
          <Button variant="ghost" size="xs" onClick={() => useEditor.getState().undo()} disabled={!canUndo} title="Undo the last cut">
            <Undo2 size={12} /> Undo
          </Button>
        }
      />
      <div ref={listRef} tabIndex={0} onKeyDown={onKeyDown} className="min-h-0 flex-1 select-none space-y-3 overflow-y-auto px-4 py-3 outline-none" aria-label="Transcript. Select words and press Delete to cut them.">
        {paragraphs.map((p) => (
          <div key={p.from} className="flex gap-2.5">
            <button type="button" onClick={() => seek(p.start)} className="mt-0.5 w-9 shrink-0 text-left font-mono text-[11px] text-label-2 hover:text-white" title="Jump here">
              {formatTime(p.start, false)}
            </button>
            <p className="min-w-0 flex-1 text-[14px] leading-7 text-white">
              {p.speaker !== undefined && <span className="mr-1.5 text-[11px] font-semibold" style={{ color: SPEAKER_COLORS[p.speaker % SPEAKER_COLORS.length] }}>Speaker {p.speaker + 1}</span>}
              {words.slice(p.from, p.to).map((w, k) => {
                const i = p.from + k;
                const selected = i >= lo && i <= hi;
                return (
                  <span
                    key={i}
                    data-w={i}
                    onMouseDown={(e) => onWordDown(e, i)}
                    onMouseEnter={() => dragging.current && setSel((s) => (s ? { anchor: s.anchor, focus: i } : s))}
                    className={cx("cursor-pointer rounded px-0.5 py-0.5", selected ? "bg-sys-blue text-white" : i === active ? "bg-sys-yellow/25 text-sys-yellow" : "hover:bg-sys-gray4")}
                  >
                    {w.text}{" "}
                  </span>
                );
              })}
            </p>
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 border-t border-sys-gray5 bg-sys-gray6/95 px-4 py-3 backdrop-blur">
        {range ? (
          <Button variant="danger" size="md" className="w-full" onClick={remove}>
            <Trash2 size={14} /> Cut {count} {count === 1 ? "word" : "words"} · {(range.end - range.start).toFixed(1)} s
          </Button>
        ) : (
          <p className="rf-read-note text-center">Select words to cut them out of the video.</p>
        )}
      </div>
    </>
  );
}
