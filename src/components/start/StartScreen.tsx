"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Upload, Film, Trash2, Copy, HardDrive, Cpu, Layers, ShieldCheck, Video, Archive, PackageOpen } from "lucide-react";
import { Recorder, useRecordingSupported } from "@/components/record/Recorder";
import { exportBackup, importBackup } from "@/lib/storage/backup";
import { requestDiskSink, createBlobSink } from "@/lib/ffmpeg/sinks";
import { downloadBlob, safeFilename } from "@/lib/utils/download";
import { createProject, type VideoProject } from "@/lib/models/project";
import { FRAME_FORMATS, getFormat } from "@/lib/models/formats";
import { projectDuration } from "@/lib/models/timeline";
import {
  listProjects,
  saveProject,
  deleteProject,
  duplicateProject,
  getProjectThumb,
  storageEstimate,
  requestPersistentStorage,
} from "@/lib/storage/db";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { formatBytes, formatTime } from "@/lib/utils/time";
import { uid } from "@/lib/utils/id";
import { ensureCrossOriginIsolation } from "@/lib/coi";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Field";
import { FileDrop } from "@/components/ui/FileDrop";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cx } from "@/lib/utils/cx";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(ts).toLocaleDateString();
}

interface Capabilities {
  webgpu: boolean;
  isolated: boolean;
  fsAccess: boolean;
}

export function StartScreen() {
  const router = useRouter();
  const [projects, setProjects] = useState<VideoProject[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [storage, setStorage] = useState<{ usage: number; quota: number; persisted: boolean } | null>(null);
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [name, setName] = useState("");
  const [formatId, setFormatId] = useState(FRAME_FORMATS[0].id);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VideoProject | null>(null);
  const [recording, setRecording] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const canRecord = useRecordingSupported();

  const backup = async (p: VideoProject) => {
    setError(null);
    const name = `${safeFilename(p.name)}.nocap`;
    try {
      const sink = (await requestDiskSink(name).catch(() => null)) ?? createBlobSink(name, "application/zip");
      setBusy(`Packing ${p.name}`);
      await exportBackup(p.id, sink, (done, total) => setBusy(`Packing ${p.name} · ${Math.round((done / total) * 100)}%`));
      const blob = await sink.close();
      if (blob) downloadBlob(blob, name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const restore = async (file: File) => {
    setError(null);
    try {
      const id = await importBackup(file, setBusy);
      setBusy(null);
      refresh();
      openProject(id);
    } catch (e) {
      setBusy(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const refresh = useCallback(async () => {
    const list = await listProjects();
    setProjects(list);
    const entries: Record<string, string> = {};
    for (const p of list) {
      const t = await getProjectThumb(p.id);
      if (t) entries[p.id] = URL.createObjectURL(t.blob);
    }
    setThumbs((old) => {
      for (const url of Object.values(old)) URL.revokeObjectURL(url);
      return entries;
    });
    setStorage(await storageEstimate());
  }, []);

  useEffect(() => {
    ensureCrossOriginIsolation();
    let cancelled = false;
    void (async () => {
      await refresh();
      if (cancelled) return;
      setCaps({
        webgpu: "gpu" in navigator,
        isolated: typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
        fsAccess: "showSaveFilePicker" in window,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const openProject = (id: string) => router.push(`/editor?id=${id}`);

  const createNew = async () => {
    const project = createProject({ name: name.trim() || "Untitled reel", formatId });
    await saveProject(project);
    await requestPersistentStorage();
    setNewOpen(false);
    openProject(project.id);
  };

  const quickImport = async (files: File[]) => {
    setError(null);
    const first = files[0];
    const project = createProject({ name: first.name.replace(/\.[^.]+$/, "") });
    await saveProject(project);
    await requestPersistentStorage();
    try {
      for (const [i, file] of files.entries()) {
        const { clip, blob } = await importVideo(file, project.id, (s) => setBusy(`${s} (${i + 1}/${files.length})`));
        project.clips.push(clip);
        if (i === 0) await updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
        await saveProject(project);
      }
      openProject(project.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
      refresh();
    }
  };

  const remove = async (p: VideoProject) => {
    await deleteProject(p.id);
    setConfirmDelete(null);
    refresh();
  };

  const duplicate = async (p: VideoProject) => {
    await duplicateProject(p.id, uid("prj"), `${p.name} copy`);
    refresh();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-500/30">
            <Film size={20} />
          </div>
          <div>
            <h1 className="text-lg font-semibold leading-tight">NoCap Edit</h1>
            <p className="text-xs text-label-3">Captioned vertical clips, edited entirely in your browser.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={backupInputRef} type="file" accept=".nocap,.zip,application/zip" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) restore(f);
          }} />
          <Button variant="secondary" onClick={() => backupInputRef.current?.click()} disabled={!!busy} title="Restore a .nocap backup">
            <PackageOpen size={16} /> Import backup
          </Button>
          {canRecord && (
            <Button variant="secondary" onClick={() => setRecording(true)} disabled={!!busy}>
              <Video size={16} /> Record
            </Button>
          )}
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            <Plus size={16} /> New project
          </Button>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-[1.4fr_1fr]">
        <FileDrop accept="video/*" multiple onFiles={quickImport} disabled={!!busy} className="flex min-h-40 flex-col items-center justify-center gap-2 bg-sys-gray5">
          <Upload size={24} className="text-label-3" />
          <p className="text-sm font-medium">Drop a recording to start a new reel</p>
          <p className="text-xs text-label-3">MP4, MOV or WebM. Files never leave this device.</p>
          {busy && (
            <div className="mt-2 w-64">
              <ProgressBar value={null} />
              <p className="mt-1 text-[11px] text-label-2">{busy}</p>
            </div>
          )}
          {error && <p className="text-xs text-sys-red">{error}</p>}
        </FileDrop>
        <div className="card p-4 text-xs text-label-2">
          <p className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
            <ShieldCheck size={16} className="text-sys-green" /> Zero-cost, on-device pipeline
          </p>
          <ul className="space-y-1.5">
            <li className="flex items-center gap-2">
              <Cpu size={14} /> Whisper speech-to-text: {caps?.webgpu ? "WebGPU accelerated" : "WASM (WebGPU unavailable)"}
            </li>
            <li className="flex items-center gap-2">
              <Layers size={14} /> ffmpeg.wasm export: {caps?.isolated ? "multi-threaded" : "single-threaded (no cross-origin isolation)"}
            </li>
            <li className="flex items-center gap-2">
              <HardDrive size={14} />
              {storage ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)} local storage${storage.persisted ? " (persistent)" : ""}` : "Local storage"}
            </li>
          </ul>
          {storage && storage.quota > 0 && <ProgressBar className="mt-3" value={storage.usage / storage.quota} />}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="mb-3 text-sm font-semibold text-label-2">Your projects</h2>
        {projects.length === 0 ? (
          <p className="card border-dashed p-8 text-center text-sm text-label-3">No projects yet. Drop a video above or create a new project.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {projects.map((p) => {
              const fmt = getFormat(p.formatId);
              return (
                <div key={p.id} className="card group overflow-hidden transition-colors hover:border-sys-gray2">
                  <button type="button" onClick={() => openProject(p.id)} className="block w-full">
                    <div className="relative aspect-[4/3] w-full overflow-hidden bg-sys-gray6">
                      {thumbs[p.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sys-gray3">
                          <Film size={28} />
                        </div>
                      )}
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white">{formatTime(projectDuration(p.clips), false)}</span>
                    </div>
                    <div className="px-3 pb-2 pt-2.5 text-left">
                      <p className="truncate text-sm font-medium text-white">{p.name}</p>
                      <p className="text-[11px] text-label-3">
                        {fmt.name} · {p.clips.length} clip{p.clips.length === 1 ? "" : "s"} · {timeAgo(p.updatedAt)}
                      </p>
                    </div>
                  </button>
                  <div className={cx("flex items-center gap-1 border-t border-sys-gray5 px-2 py-1 opacity-70 transition-opacity group-hover:opacity-100")}>
                    <Button variant="ghost" size="xs" onClick={() => duplicate(p)} title="Duplicate">
                      <Copy size={12} /> Duplicate
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => backup(p)} title="Save a .nocap backup with all media" disabled={!!busy}>
                      <Archive size={12} /> Backup
                    </Button>
                    <Button variant="ghost" size="xs" className="ml-auto text-sys-red hover:text-red-200" onClick={() => setConfirmDelete(p)} title="Delete">
                      <Trash2 size={12} /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="mt-auto pt-10 text-[11px] text-label-3">
        Projects, clips and models are stored in this browser only. Clearing site data removes them.
      </footer>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New project">
        <div className="space-y-4">
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Untitled reel" />
          </Field>
          <Field label="Frame format">
            <div className="grid max-h-72 grid-cols-2 gap-2 overflow-y-auto pr-1">
              {FRAME_FORMATS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFormatId(f.id)}
                  className="tile flex-row justify-start gap-3 px-3 py-2 text-left"
                  data-active={formatId === f.id ? "true" : "false"}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center">
                    <span className="block rounded-sm border border-sys-gray2 bg-sys-gray4" style={{ width: f.width >= f.height ? 32 : (32 * f.width) / f.height, height: f.height >= f.width ? 32 : (32 * f.height) / f.width }} />
                  </span>
                  <span>
                    <span className="block text-sm">{f.name}</span>
                    <span className="block text-[11px] text-label-3">
                      {f.width}×{f.height} · {f.ratio}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={createNew}>
              Create
            </Button>
          </div>
        </div>
      </Modal>

      <Recorder open={recording} onClose={() => setRecording(false)} onRecorded={(file) => {
        setRecording(false);
        quickImport([file]);
      }} />

      <Modal open={!!confirmDelete} onClose={() => setConfirmDelete(null)} title="Delete project?">
        <p className="text-sm text-label-2">
          “{confirmDelete?.name}” and its imported media will be removed from this device. This cannot be undone.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Keep
          </Button>
          <Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)}>
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
