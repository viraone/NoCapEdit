"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEditor, flushSave } from "@/store/editorStore";
import { ensureCrossOriginIsolation } from "@/lib/coi";
import { EditorShell } from "./EditorShell";

export function EditorPage() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const project = useEditor((s) => s.project);
  const loading = useEditor((s) => s.loading);
  const error = useEditor((s) => s.error);
  const loadProject = useEditor((s) => s.loadProject);

  useEffect(() => {
    ensureCrossOriginIsolation();
    if (!id) {
      router.replace("/");
      return;
    }
    loadProject(id);
    return () => {
      flushSave().finally(() => useEditor.getState().unload());
    };
  }, [id, loadProject, router]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 text-sm text-label-2">
        <p>{error}</p>
        <Link href="/" className="text-brand-400 underline">
          Back to projects
        </Link>
      </div>
    );
  }
  if (!project || loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-label-3">Opening project…</div>;
  }
  return <EditorShell />;
}
