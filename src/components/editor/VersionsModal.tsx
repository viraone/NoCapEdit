"use client";
import { useCallback, useEffect, useState } from "react";
import { History, RotateCcw, Trash2, Save } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { deleteVersion, listVersions, type VersionRecord } from "@/lib/storage/db";
import { MAX_NAME_LENGTH, MAX_VERSIONS, restoreProject, sameEdit, saveVersion, versionSummary } from "@/lib/storage/versions";
import { projectDuration } from "@/lib/models/timeline";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** Save the project under a name and go back to any saved version. */
export function VersionsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Saved versions" width="max-w-xl">
      {/* Mounted only while open, so every visit starts with a fresh list and an empty name. */}
      <VersionsBody onClose={onClose} />
    </Modal>
  );
}

function VersionsBody({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)!;
  const [versions, setVersions] = useState<VersionRecord[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setVersions(await listVersions(project.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setVersions([]);
    }
  }, [project.id]);

  useEffect(() => {
    let alive = true;
    listVersions(project.id)
      .then((list) => alive && setVersions(list))
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setVersions([]);
      });
    return () => {
      alive = false;
    };
  }, [project.id]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // The version is the project as it is on screen right now, so a pending autosave is not waited for.
      const record = await saveVersion(useEditor.getState().project!, name, versions ?? undefined);
      setName("");
      await reload();
      useEditor.getState().setNotice(`Saved “${record.name}”. Find it again under Project, then Saved versions.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (v: VersionRecord) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const state = useEditor.getState();
      const current = state.project!;
      const list = versions ?? [];
      // What is on screen now is kept as a version too, unless a saved one already matches it.
      let kept = false;
      if (!list.some((x) => sameEdit(x.project, current))) {
        try {
          await saveVersion(current, `Before going back to “${v.name}”`, list);
          kept = true;
        } catch {
          /* the list is full: undo still brings the old state back */
        }
      }
      const next = restoreProject(current, v.project);
      state.update(() => next);
      state.select(null);
      state.seek(Math.min(state.currentTime, projectDuration(next.clips)));
      state.setNotice(`Went back to “${v.name}”.${kept ? " What you had is saved as a version too." : ""} Undo brings back what you had.`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: VersionRecord) => {
    if (confirmDelete !== v.id) {
      setConfirmDelete(v.id);
      return;
    }
    setConfirmDelete(null);
    try {
      await deleteVersion(v.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const full = (versions?.length ?? 0) >= MAX_VERSIONS;

  return (
    <>
      <div data-versions-modal>
        <p className="text-[13px] leading-relaxed text-label-2">
          Save the video as it is now, with a name you will recognise. Go back to any version later; going back keeps what you had, so nothing is lost.
        </p>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            className="h-[40px] min-w-0 flex-1 rounded-[10px] border border-sys-gray4 bg-sys-gray5 px-3 text-[14px] placeholder:text-label-3 focus:border-sys-blue focus:outline-none"
            placeholder="Name it, e.g. Before the new intro"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            onChange={(e) => setName(e.target.value)}
            aria-label="Version name"
            disabled={busy || full}
            data-version-name
          />
          <Button variant="primary" size="bar" type="submit" disabled={busy || full} data-version-save>
            <Save size={16} /> Save
          </Button>
        </form>
        {full && <p className="mt-2 text-[12px] text-sys-orange">A project keeps up to {MAX_VERSIONS} saved versions. Delete an old one to save a new one.</p>}
        {error && <p className="mt-2 whitespace-pre-wrap text-[12px] text-sys-red">{error}</p>}

        <div className="mt-4 border-t border-sys-gray5 pt-3">
          {versions === null ? (
            <p className="text-[13px] text-label-2">Loading…</p>
          ) : versions.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-label-2">
              <History size={15} /> No saved versions yet.
            </p>
          ) : (
            <ul className="space-y-2" data-version-list>
              {versions.map((v) => {
                const same = sameEdit(v.project, project);
                return (
                  <li key={v.id} className="flex items-center gap-3 rounded-[10px] border border-sys-gray4 bg-sys-gray5 px-3 py-2.5" data-version-row>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-[14px] font-semibold">
                        <span className="truncate">{v.name}</span>
                        {same && <span className="shrink-0 rounded-full bg-sys-green/15 px-2 py-0.5 text-[11px] font-semibold text-sys-green">Same as now</span>}
                      </p>
                      <p className="text-[12px] text-label-2">
                        {when(v.createdAt)} · {versionSummary(v.project)}
                      </p>
                    </div>
                    <Button variant="secondary" size="sm" onClick={() => restore(v)} disabled={busy || same} title={same ? "The video is already exactly like this" : "Go back to this version"}>
                      <RotateCcw size={13} /> Go back
                    </Button>
                    <Button variant={confirmDelete === v.id ? "danger" : "ghost"} size="sm" onClick={() => remove(v)} disabled={busy} aria-label={`Delete ${v.name}`}>
                      <Trash2 size={13} /> {confirmDelete === v.id ? "Sure?" : "Delete"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
