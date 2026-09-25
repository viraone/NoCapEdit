"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { Folder, MoreHorizontal, Home, Undo2, Redo2, Upload, Share } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { useImportClips } from "@/components/panels/useImportClips";
import { Button } from "@/components/ui/Button";
import { cx } from "@/lib/utils/cx";

export function TopBar() {
  const project = useEditor((s) => s.project)!;
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { undo, redo, update, setTool } = useEditor.getState();
  const { onFiles, busy } = useImportClips();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
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
        <button type="button" className="rounded-md p-1 text-label-2 hover:bg-sys-gray5 hover:text-white" title="Rename" onClick={openRename}>
          <MoreHorizontal size={16} />
        </button>
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
        <input ref={fileRef} type="file" accept="video/*" multiple className="hidden" onChange={(e) => {
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
