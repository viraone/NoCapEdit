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
import { isImageFile, toClipFile, STILL_SECONDS } from "@/lib/media/stillVideo";
import { fitZoom } from "@/lib/models/clipOps";
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
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deletingAll, setDeletingAll] = useState(false);
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
    // A flyer or poster becomes an Instagram post: 4:5 frame, whole image visible.
    const stillFirst = isImageFile(first);
    const project = createProject({ name: first.name.replace(/\.[^.]+$/, ""), ...(stillFirst ? { formatId: "ig-portrait" } : {}) });
    const format = getFormat(project.formatId);
    await saveProject(project);
    await requestPersistentStorage();
    try {
      for (const [i, raw] of files.entries()) {
        const status = (s: string) => setBusy(`${s} (${i + 1}/${files.length})`);
        const file = await toClipFile(raw, status);
        const { clip, blob } = await importVideo(file, project.id, status);
        if (isImageFile(raw)) {
          clip.zoom = fitZoom({ width: clip.width, height: clip.height }, { width: format.width, height: format.height });
          clip.pan = { x: 0, y: 0 };
        }
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

  /** Removes every project on this device (reels go with their sources; the rest one by one). */
  const removeAll = async () => {
    setDeletingAll(true);
    try {
      const list = await listProjects();
      for (const p of list.filter((p) => !p.sourceProjectId)) await deleteProject(p.id);
      for (const p of await listProjects()) await deleteProject(p.id);
    } finally {
      setDeletingAll(false);
      setConfirmDeleteAll(false);
      refresh();
    }
  };

  const duplicate = async (p: VideoProject) => {
    await duplicateProject(p.id, uid("prj"), `${p.name} copy`);
    refresh();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-8 py-10 text-[15px]">
      <header className="flex flex-wrap items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-lg shadow-brand-500/40">
            <Film size={28} />
          </div>
          <div>
            <h1 className="text-3xl font-semibold leading-tight tracking-tight">NoCap Edit</h1>
            <p className="mt-1 text-base text-label-2">Captioned vertical clips, edited entirely in your browser.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={backupInputRef} type="file" accept=".nocap,.zip,application/zip" className="hidden" onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) restore(f);
          }} />
          <Button variant="secondary" size="lg" onClick={() => backupInputRef.current?.click()} disabled={!!busy} title="Restore a .nocap backup">
            <PackageOpen size={18} /> Import backup
          </Button>
          {canRecord && (
            <Button variant="secondary" size="lg" onClick={() => setRecording(true)} disabled={!!busy}>
              <Video size={18} /> Record
            </Button>
          )}
          <Button variant="primary" size="lg" onClick={() => setNewOpen(true)}>
            <Plus size={18} /> New project
          </Button>
        </div>
      </header>

      <section className="mt-12 grid gap-6 md:grid-cols-[1.5fr_1fr]">
        <FileDrop
          accept="video/*,image/*"
          multiple
          onFiles={quickImport}
          disabled={!!busy}
          className="relative flex min-h-72 flex-col items-center justify-center gap-3 overflow-hidden rounded-3xl bg-sys-gray5 px-8 py-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_20px_50px_rgba(0,0,0,0.45)]"
        >
          <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 h-64 w-[36rem] -translate-x-1/2 rounded-full bg-sys-blue/15 blur-3xl" />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-sys-gray4 text-sys-blue shadow-inner shadow-black/40">
            <Upload size={36} />
          </div>
          <p className="relative text-2xl font-semibold tracking-tight">Drop a recording or a flyer to start a new reel</p>
          <p className="relative text-base text-label-2">MP4, MOV, WebM · or an image, which becomes an {STILL_SECONDS} s Instagram post · files never leave this device</p>
          {busy && (
            <div className="relative mt-3 w-80">
              <ProgressBar value={null} className="h-2" />
              <p className="mt-2 text-sm text-label-2">{busy}</p>
            </div>
          )}
          {error && <p className="relative text-sm text-sys-red">{error}</p>}
        </FileDrop>
        <div className="card flex flex-col justify-center rounded-3xl p-6 text-[15px] text-label-2">
          <p className="mb-5 flex items-center gap-2.5 text-lg font-semibold text-white">
            <ShieldCheck size={22} className="text-sys-green" /> Zero-cost, on-device pipeline
          </p>
          <ul className="space-y-3.5">
            <li className="flex items-start gap-3">
              <Cpu size={20} className="mt-0.5 shrink-0 text-sys-teal" />
              <span>
                <span className="block text-white">Whisper speech-to-text</span>
                <span className="text-label-3">{caps?.webgpu ? "WebGPU accelerated" : "WASM (WebGPU unavailable)"}</span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <Layers size={20} className="mt-0.5 shrink-0 text-sys-purple" />
              <span>
                <span className="block text-white">ffmpeg.wasm export</span>
                <span className="text-label-3">{caps?.isolated ? "multi-threaded" : "single-threaded (no cross-origin isolation)"}</span>
              </span>
            </li>
            <li className="flex items-start gap-3">
              <HardDrive size={20} className="mt-0.5 shrink-0 text-sys-orange" />
              <span>
                <span className="block text-white">Local storage</span>
                <span className="text-label-3">{storage ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}${storage.persisted ? " · persistent" : ""}` : "Checking…"}</span>
              </span>
            </li>
          </ul>
          {storage && storage.quota > 0 && <ProgressBar className="mt-5 h-2" value={storage.usage / storage.quota} />}
        </div>
      </section>

      <section className="mt-14">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold tracking-tight">Your projects</h2>
          {projects.length > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-label-3">{projects.length} project{projects.length === 1 ? "" : "s"}</span>
              <Button variant="ghost" size="sm" className="text-sys-red hover:text-red-200" onClick={() => setConfirmDeleteAll(true)} disabled={!!busy} title="Delete every project and its media from this device" data-delete-all>
                <Trash2 size={13} /> Delete all
              </Button>
            </div>
          )}
        </div>
        {projects.length === 0 ? (
          <p className="card rounded-3xl border-dashed p-14 text-center text-lg text-label-3">No projects yet. Drop a video above or create a new project.</p>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => {
              const fmt = getFormat(p.formatId);
              return (
                <div key={p.id} className="card group overflow-hidden rounded-3xl transition-all duration-200 hover:-translate-y-1 hover:border-sys-gray2 hover:shadow-[0_24px_60px_rgba(0,0,0,0.55)]">
                  <button type="button" onClick={() => openProject(p.id)} className="block w-full">
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-sys-gray6">
                      {thumbs[p.id] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumbs[p.id]} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-sys-gray3">
                          <Film size={44} />
                        </div>
                      )}
                      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/70 to-transparent" />
                      <span className="absolute bottom-3 right-3 rounded-lg bg-black/70 px-2.5 py-1 text-sm font-semibold tabular-nums text-white backdrop-blur">{formatTime(projectDuration(p.clips), false)}</span>
                      {p.reel && <span className="absolute left-2 top-2 rounded bg-sys-purple/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">Reel {p.reel.index} · {p.reel.score}/10</span>}
                      <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-xs font-semibold text-label-2 backdrop-blur">{fmt.name}</span>
                    </div>
                    <div className="px-5 pb-3 pt-4 text-left">
                      <p className="truncate text-lg font-semibold text-white">{p.name}</p>
                      <p className="mt-1 text-sm text-label-3">
                        {p.clips.length} clip{p.clips.length === 1 ? "" : "s"} · {timeAgo(p.updatedAt)}
                      </p>
                    </div>
                  </button>
                  <div className={cx("flex items-center gap-1.5 border-t border-sys-gray5 px-3 py-2 opacity-80 transition-opacity group-hover:opacity-100")}>
                    <Button variant="ghost" size="sm" onClick={() => duplicate(p)} title="Duplicate">
                      <Copy size={14} /> Duplicate
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => backup(p)} title="Save a .nocap backup with all media" disabled={!!busy}>
                      <Archive size={14} /> Backup
                    </Button>
                    <Button variant="ghost" size="sm" className="ml-auto text-sys-red hover:text-red-200" onClick={() => setConfirmDelete(p)} title="Delete">
                      <Trash2 size={14} /> Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <footer className="mt-auto pt-14 text-sm text-label-3">
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
                    <span className="block text-[15px]">{f.name}</span>
                    <span className="block text-xs text-label-3">
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

      <Modal open={confirmDeleteAll} onClose={() => !deletingAll && setConfirmDeleteAll(false)} title="Delete all projects?">
        <p className="text-sm text-label-2">
          All {projects.length} project{projects.length === 1 ? "" : "s"}, their imported media, captions and reels will be removed from this device. This cannot be undone. Use Backup first if you want to keep any of them.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDeleteAll(false)} disabled={deletingAll}>
            Keep
          </Button>
          <Button variant="danger" onClick={removeAll} disabled={deletingAll} data-confirm-delete-all>
            {deletingAll ? "Deleting…" : `Delete all ${projects.length}`}
          </Button>
        </div>
      </Modal>

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
