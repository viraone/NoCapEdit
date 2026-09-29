"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Folder, MoreHorizontal, Home, Undo2, Redo2, Upload, Share, Pencil, RefreshCw, Clapperboard, ArrowLeft } from "lucide-react";
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
    <header className="flex h-11 shrink-0 items-center gap-3 px-2">
      <div className="flex min-w-0 items-center gap-2">
        {editing ? (
          <input
            autoFocus
            className="h-8 w-56 rounded-lg border border-sys-blue bg-sys-gray5 px-2 text-[15px] font-bold focus:outline-none"
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
          <button type="button" className="truncate text-[15px] font-bold tracking-tight hover:text-label-2" onClick={openRename} title="Rename">
            {project.name}
          </button>
        )}
        <Link href="/" className="rounded-md p-1 text-label-2 hover:bg-sys-gray5 hover:text-white" title="All projects">
          <Folder size={16} />
        </Link>
        {project.sourceProjectId && (
          <Link href={`/editor?id=${project.sourceProjectId}&tool=reels`} className="flex items-center gap-1 rounded-md bg-sys-pink/15 px-2 py-1 text-[11px] font-semibold text-sys-pink hover:bg-sys-pink/25" title="Back to the video this reel was cut from" data-back-to-source>
            <ArrowLeft size={12} /> Back to source · Reels
          </Link>
        )}
        <div ref={menuRef} className="relative">
          <button type="button" className={cx("rounded-md p-1 text-label-2 hover:bg-sys-gray5 hover:text-white", menuOpen && "bg-sys-gray5 text-white")} title="Project menu" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div role="menu" className="card absolute left-0 top-8 z-40 w-56 p-1 text-[13px]">
              <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sys-gray4" onClick={() => (setMenuOpen(false), openRename())}>
                <Pencil size={14} /> Rename video
              </button>
              <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sys-gray4" onClick={() => (setMenuOpen(false), replaceRef.current?.click())}>
                <RefreshCw size={14} /> Replace entire video
              </button>
              <button type="button" role="menuitem" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-sys-gray4 disabled:opacity-50" disabled={!project.clips.length} onClick={() => (setMenuOpen(false), useEditor.getState().requestReels())}>
                <Clapperboard size={14} /> Make reels
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
        <span className="mx-1 h-4 w-px bg-sys-gray4" />
        <Button variant="ghost" size="iconSm" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          <Undo2 size={14} />
        </Button>
        <Button variant="ghost" size="iconSm" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          <Redo2 size={14} />
        </Button>
      </div>

      <div className="mx-auto flex items-center rounded-[10px] bg-sys-gray5 p-0.5">
        <Link href="/" className={cx("flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-label-2 hover:text-white")} title="Home">
          <Home size={15} />
        </Link>
        <span className="flex h-8 items-center rounded-lg bg-sys-gray3 px-4 text-[13px] font-bold text-white">Edit</span>
      </div>

      <div className="flex items-center gap-2">
        <input ref={fileRef} type="file" accept="video/*,image/*" multiple className="hidden" onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }} />
        <Button variant="secondary" size="md" onClick={() => fileRef.current?.click()} disabled={busy}>
          <Upload size={15} /> Import clips
        </Button>
        <Button variant="primary" size="md" onClick={() => setTool("export")}>
          <Share size={15} /> Export video
        </Button>
      </div>
    </header>
  );
}
