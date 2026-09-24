"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Undo2, Redo2, Download, Film } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { getFormat } from "@/lib/models/formats";
import type { SafeZoneKind } from "@/lib/models/formats";

export function TopBar() {
  const project = useEditor((s) => s.project)!;
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const saveState = useEditor((s) => s.saveState);
  const { undo, redo, update, setTool } = useEditor.getState();
  const [name, setName] = useState(project.name);
  const [prevName, setPrevName] = useState(project.name);
  if (prevName !== project.name) {
    setPrevName(project.name);
    setName(project.name);
  }
  const format = getFormat(project.formatId);

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-950 px-3">
      <Link href="/" className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white">
        <ArrowLeft size={14} /> Projects
      </Link>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-500 text-white">
          <Film size={14} />
        </div>
        <input
          className="h-8 w-56 rounded-md border border-transparent bg-transparent px-2 text-sm font-medium hover:border-neutral-700 focus:border-brand-500/60 focus:outline-none"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim() || "Untitled reel";
            if (n !== project.name) update((p) => void (p.name = n));
            setName(n);
          }}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label="Project name"
        />
        <span className="hidden text-[11px] text-neutral-500 md:inline">
          {format.name} · {format.width}×{format.height}
        </span>
      </div>
      <div className="mx-2 flex items-center gap-1">
        <Button variant="ghost" size="iconSm" onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
          <Undo2 size={15} />
        </Button>
        <Button variant="ghost" size="iconSm" onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
          <Redo2 size={15} />
        </Button>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-[11px] text-neutral-500">{saveState === "saved" ? "Saved on this device" : saveState === "saving" ? "Saving…" : "Unsaved changes"}</span>
        <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          Safe zone
          <Select className="h-7 w-36 text-xs" value={project.safeZone} onChange={(e) => update((p) => void (p.safeZone = e.target.value as SafeZoneKind))}>
            <option value="none">Off</option>
            <option value="reels">Instagram Reels</option>
            <option value="tiktok">TikTok</option>
            <option value="shorts">YouTube Shorts</option>
          </Select>
        </label>
        <Button variant="primary" size="sm" onClick={() => setTool("export")}>
          <Download size={14} /> Export
        </Button>
      </div>
    </header>
  );
}
