"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Undo2, Redo2, Upload, Share, Pencil, RefreshCw, Clapperboard, ArrowLeft, Check, Loader2 } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useImportClips } from "@/components/panels/useImportClips";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Toggle } from "@/components/ui/Toggle";
import { cx } from "@/lib/utils/cx";

export function TopBar() {
  const project = useEditor((s) => s.project)!;
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const saveState = useEditor((s) => s.saveState);
  const { undo, redo, update, setTool } = useEditor.getState();
  const { onFiles, busy } = useImportClips();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [keepCaptions, setKeepCaptions] = useState(false);
  const [replacing, setReplacing] = useState<string | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", key);
    };
  }, [menuOpen]);
  /** Swaps the whole video for a new file: one clip, same name/format/music/text; captions cleared unless kept. */
  const replaceVideo = async () => {
    if (!replaceFile) return;
    setReplaceError(null);
    setReplacing(`Reading ${replaceFile.name}`);
    try {
      const { clip, assetId, blob } = await importVideo(replaceFile, project.id, (m) => setReplacing(m));
      useEditor.getState().registerAsset(assetId, blob);
      update((p) => {
        const old = p.clips[0];
        p.clips = [{ ...clip, ...(old ? { background: old.background, look: old.look ?? null } : {}) }];
        if (!keepCaptions) p.cues = [];
      });
      updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
      useEditor.getState().setNotice(`Replaced the video with ${replaceFile.name}${keepCaptions ? "" : " and cleared the captions"}. Undo brings the old one back.`);
      setReplaceFile(null);
    } catch (e) {
      setReplaceError(e instanceof Error ? e.message : String(e));
    } finally {
      setReplacing(null);
    }
  };
  const [name, setName] = useState(project.name);
  const [prevName, setPrevName] = useState(project.name);
  if (prevName !== project.name) {
    setPrevName(project.name);
    setName(project.name);
  }
  const openRename = () => {
    setName(project.name);
    setEditing(true);
  };
  const commitName = () => {
    const n = name.trim() || "Untitled reel";
    if (n !== project.name) update((p) => void (p.name = n));
    setName(n);
    setEditing(false);
  };

  return (
    <header className="-mx-2.5 -mt-2.5 mb-0.5 flex h-[56px] shrink-0 items-center gap-3 border-b border-white/10 bg-[#141416] px-[16px]" data-top-bar>
      <div className="flex min-w-0 items-center gap-[10px]">
        <Link href="/" className="flex h-[40px] shrink-0 items-center gap-2 rounded-[10px] border border-white/5 bg-sys-gray5 px-[14px] text-[14px] font-semibold text-white hover:bg-sys-gray4" title="All projects" data-projects-link>
          <ArrowLeft size={17} /> Projects
        </Link>
        <span className="h-[24px] w-px shrink-0 bg-white/10" />
        {editing ? (
          <input
            autoFocus
            className="h-[40px] w-[300px] rounded-[10px] border border-sys-blue bg-sys-gray5 px-[10px] text-[19px] font-bold focus:outline-none"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              if (e.key === "Escape") {
                setName(project.name);
                setEditing(false);
              }
            }}
            aria-label="Project name"
          />
        ) : (
          <button type="button" className="group flex min-w-0 items-center gap-2 rounded-[10px] px-1.5 py-1 hover:bg-white/5" onClick={openRename} title="Rename" data-project-title>
            <span className="truncate text-[19px] font-bold tracking-tight">{project.name}</span>
            <Pencil size={15} className="shrink-0 text-label-2 opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        )}
        <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-label-2" aria-live="polite" data-save-state={saveState}>
          {saveState === "saved" ? (
            <>
              <Check size={14} className="text-sys-green" /> Saved
            </>
          ) : (
            <>
              <Loader2 size={14} className="animate-spin" /> Saving…
            </>
          )}
        </span>
        {project.sourceProjectId && (
          <Link href={`/editor?id=${project.sourceProjectId}&tool=reels`} className="flex h-[36px] shrink-0 items-center gap-1.5 rounded-[10px] bg-sys-pink/15 px-[12px] text-[13px] font-semibold text-sys-pink hover:bg-sys-pink/25" title="Back to the source video and the list of all its reels" data-back-to-source>
            <ArrowLeft size={15} /> All reels
          </Link>
        )}
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            className={cx("flex h-[40px] items-center gap-1.5 rounded-[10px] px-[12px] text-[14px] font-semibold text-white hover:bg-sys-gray5", menuOpen && "bg-sys-gray5")}
            title="Project menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            data-project-menu
          >
            Project <ChevronDown size={16} className={cx("text-label-2 transition-transform", menuOpen && "rotate-180")} />
          </button>
          {menuOpen && (
            <div role="menu" className="card absolute left-0 top-[48px] z-40 w-[260px] p-1.5 text-[14px]">
              <button type="button" role="menuitem" className="flex w-full items-center gap-[10px] rounded-lg px-[10px] py-[8px] text-left hover:bg-sys-gray4" onClick={() => (setMenuOpen(false), openRename())}>
                <Pencil size={16} /> Rename video
              </button>
              <button type="button" role="menuitem" className="flex w-full items-center gap-[10px] rounded-lg px-[10px] py-[8px] text-left hover:bg-sys-gray4" onClick={() => (setMenuOpen(false), replaceRef.current?.click())}>
                <RefreshCw size={16} /> Replace entire video
              </button>
              <button type="button" role="menuitem" className="flex w-full items-center gap-[10px] rounded-lg px-[10px] py-[8px] text-left hover:bg-sys-gray4 disabled:opacity-50" disabled={!project.clips.length} onClick={() => (setMenuOpen(false), useEditor.getState().requestReels())}>
                <Clapperboard size={16} /> Make reels
              </button>
            </div>
          )}
        </div>
        <input ref={replaceRef} type="file" accept="video/*" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) {
            setKeepCaptions(false);
            setReplaceError(null);
            setReplaceFile(f);
          }
        }} />
        <Modal open={!!replaceFile} onClose={() => !replacing && setReplaceFile(null)} title="Replace entire video?">
          <p className="text-sm text-label-2">
            “{replaceFile?.name}” becomes the only clip in <b className="text-white">{project.name}</b>. The name, frame format, music, text and stickers stay. Undo brings the old video back.
          </p>
          <div className="mt-3">
            <Toggle checked={keepCaptions} onChange={setKeepCaptions} label="Keep the captions" description="They were timed to the old audio; off clears them so you can generate new ones" />
          </div>
          {replaceError && <p className="mt-2 text-[11px] text-sys-red">{replaceError}</p>}
          <div className="mt-4 flex items-center justify-end gap-2">
            {replacing && <span className="mr-auto text-[11px] text-label-2">{replacing}</span>}
            <Button variant="ghost" onClick={() => setReplaceFile(null)} disabled={!!replacing}>
              Cancel
            </Button>
            <Button variant="primary" onClick={replaceVideo} disabled={!!replacing}>
              Replace
            </Button>
          </div>
        </Modal>
        <span className="h-[24px] w-px shrink-0 bg-white/10" />
        <Button variant="ghost" size="iconBar" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" aria-label="Undo">
          <Undo2 size={18} />
        </Button>
        <Button variant="ghost" size="iconBar" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" aria-label="Redo">
          <Redo2 size={18} />
        </Button>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-[10px]">
        <input ref={fileRef} type="file" accept="video/*,image/*" multiple className="hidden" onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }} />
        <Button variant="secondary" size="bar" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={17} /> Import clips
        </Button>
        <Button variant="primary" size="bar" onClick={() => setTool("export")}>
          <Share size={17} /> Export video
        </Button>
      </div>
    </header>
  );
}
