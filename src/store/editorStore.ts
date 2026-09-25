import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { normalizeProject, type VideoProject } from "@/lib/models/project";
import { getProject, listProjectAssets, saveProject } from "@/lib/storage/db";
import { engine } from "@/lib/playback/engine";
import { clampDockHeight, readStoredDockHeight, storeDockHeight } from "@/components/timeline/dockLayout";

export type ToolId = "clips" | "trim" | "subtitles" | "style" | "text" | "picture" | "music" | "export";

export interface Selection {
  kind: "clip" | "cue" | "overlay" | "voiceover";
  id: string;
}

export type CanvasZoom = "fit" | number;

export interface EditorState {
  project: VideoProject | null;
  loading: boolean;
  error: string | null;
  past: VideoProject[];
  future: VideoProject[];
  txSnapshot: VideoProject | null;
  saveState: "saved" | "saving" | "dirty";
  tool: ToolId;
  currentTime: number;
  isPlaying: boolean;
  selection: Selection | null;
  assetUrls: Record<string, string>;
  timelineZoom: number;
  /** Height of the timeline dock (px), dragged via the grip above it and remembered across sessions. */
  timelineHeight: number;
  canvasZoom: CanvasZoom;
  /** One-line status shown under the top bar (auto-dismissed). */
  notice: string | null;
  /** Set by a canvas double-click: the panel for this element should focus its content field. */
  editRequest: (Selection & { nonce: number }) | null;
  /** Progress line of the video import running in this editor (shared by the top bar and the Clips panel), null when idle. */
  importStatus: string | null;
  /** Files the last import could not add, one "name: reason" per line; shown by the Clips panel. */
  importError: string | null;
  /** Assets already written to IndexedDB by an import whose clip has not joined the project yet. */
  pendingAssetIds: string[];

  loadProject(id: string): Promise<boolean>;
  unload(): void;
  update(fn: (draft: VideoProject) => void | VideoProject, opts?: { history?: boolean }): void;
  /** Opens an undo transaction; false when one is already open (the caller then does not own it). */
  beginTransaction(): boolean;
  /** Closes the transaction; true when it recorded an undo step. */
  endTransaction(): boolean;
  undo(): void;
  redo(): void;
  setTool(tool: ToolId): void;
  setTime(t: number): void;
  seek(t: number): void;
  setPlaying(playing: boolean): void;
  select(sel: Selection | null): void;
  setTimelineZoom(z: number): void;
  setTimelineHeight(h: number): void;
  /** Re-clamps the dock to the current window without changing the stored preference, so it grows back later. */
  fitTimelineHeightToWindow(): void;
  setCanvasZoom(z: CanvasZoom): void;
  setNotice(text: string | null): void;
  /** Selects the element, switches to its panel and asks that panel to focus its editor. */
  requestEdit(sel: Selection): void;
  registerAsset(assetId: string, blob: Blob): string;
  releaseAsset(assetId: string): void;
  setImportStatus(status: string | null): void;
  setImportError(error: string | null): void;
  markAssetPending(assetId: string): void;
  unmarkAssetPending(assetId: string): void;
}

const MAX_HISTORY = 60;

/** Structural equality over the plain JSON values a project is made of. */
export function sameProject(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameProject(v, b[i]));
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameProject((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/**
 * Synchronous safety copy of an unsaved project, written when the page is
 * hidden or unloaded. Browsers abandon IndexedDB writes started during unload,
 * so a reload right after an edit would otherwise lose it; the next load
 * restores the copy when it is newer than the stored project.
 */
const JOURNAL_KEY = "reelflow.unsaved";

function writeJournal(project: VideoProject) {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(project));
  } catch {
    /* storage full or unavailable: the IndexedDB flush is the only attempt */
  }
}

function readJournal(id: string): VideoProject | null {
  try {
    const raw = localStorage.getItem(JOURNAL_KEY);
    const p = raw ? (JSON.parse(raw) as VideoProject) : null;
    return p && p.id === id ? p : null;
  } catch {
    return null;
  }
}

/** Drops the safety copy once a save at least as new has reached IndexedDB. */
function clearJournal(saved: VideoProject) {
  try {
    const j = readJournal(saved.id);
    if (j && j.updatedAt <= saved.updatedAt) localStorage.removeItem(JOURNAL_KEY);
  } catch {
    /* ignore */
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(project: VideoProject, set: (s: Partial<EditorState>) => void) {
  if (saveTimer) clearTimeout(saveTimer);
  set({ saveState: "dirty" });
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    set({ saveState: "saving" });
    try {
      await saveProject(project);
      clearJournal(project);
      set({ saveState: "saved" });
    } catch (e) {
      console.error("Autosave failed", e);
      set({ saveState: "dirty" });
    }
  }, 500);
}

export const useEditor = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    project: null,
    loading: false,
    error: null,
    past: [],
    future: [],
    txSnapshot: null,
    saveState: "saved",
    tool: "clips",
    currentTime: 0,
    isPlaying: false,
    selection: null,
    assetUrls: {},
    timelineZoom: 80,
    timelineHeight: readStoredDockHeight(),
    canvasZoom: "fit",
    notice: null,
    editRequest: null,
    importStatus: null,
    importError: null,
    pendingAssetIds: [],

    async loadProject(id) {
      get().unload();
      set({ loading: true, error: null });
      try {
        let project = await getProject(id);
        const journal = project ? readJournal(id) : null;
        if (project && journal) {
          if (journal.updatedAt > project.updatedAt) {
            project = normalizeProject(journal);
            await saveProject(project);
          }
          clearJournal(project);
        }
        if (!project) {
          set({ loading: false, error: "This project no longer exists on this device." });
          return false;
        }
        const assets = await listProjectAssets(id);
        const assetUrls: Record<string, string> = {};
        for (const a of assets) assetUrls[a.id] = URL.createObjectURL(a.blob);
        set({ project, assetUrls, loading: false, past: [], future: [], currentTime: 0, isPlaying: false, selection: null, tool: "clips" });
        return true;
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },

    unload() {
      for (const url of Object.values(get().assetUrls)) URL.revokeObjectURL(url);
      engine.dispose();
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      set({ project: null, assetUrls: {}, past: [], future: [], txSnapshot: null, selection: null, currentTime: 0, isPlaying: false, editRequest: null, importStatus: null, importError: null, pendingAssetIds: [], notice: null });
    },

    update(fn, opts = {}) {
      const { project, past, txSnapshot } = get();
      if (!project) return;
      const draft = structuredClone(project);
      const next = (fn(draft) ?? draft) as VideoProject;
      // A refused or no-op edit (split outside a clip, zoom at its limit, an
      // already active preset...) records no undo step, keeps redo and does
      // not autosave. Pointer-move updates skip the compare for speed.
      if (opts.history !== false && sameProject(project, next)) return;
      next.updatedAt = Date.now();
      const record = opts.history !== false && !txSnapshot;
      set({
        project: next,
        past: record ? [...past.slice(-(MAX_HISTORY - 1)), project] : past,
        future: record ? [] : get().future,
      });
      scheduleSave(next, set);
    },

    beginTransaction() {
      const { project, txSnapshot } = get();
      // Project objects are never mutated in place, so the reference is a snapshot.
      if (project && !txSnapshot) {
        set({ txSnapshot: project });
        return true;
      }
      return false;
    },

    endTransaction() {
      const { txSnapshot, past, project } = get();
      if (!txSnapshot) return false;
      if (project === txSnapshot) {
        set({ txSnapshot: null });
        return false;
      }
      set({ txSnapshot: null, past: [...past.slice(-(MAX_HISTORY - 1)), txSnapshot], future: [] });
      return true;
    },

    undo() {
      const { past, project, future } = get();
      if (!past.length || !project) return;
      const prev = past[past.length - 1];
      set({ project: prev, past: past.slice(0, -1), future: [project, ...future].slice(0, MAX_HISTORY), txSnapshot: null });
      scheduleSave(prev, set);
    },

    redo() {
      const { past, project, future } = get();
      if (!future.length || !project) return;
      const next = future[0];
      set({ project: next, past: [...past, project].slice(-MAX_HISTORY), future: future.slice(1), txSnapshot: null });
      scheduleSave(next, set);
    },

    setTool: (tool) => set({ tool }),
    setTime: (currentTime) => set({ currentTime }),
    seek(t) {
      engine.seek(t);
      set({ currentTime: engine.time });
    },
    setPlaying: (isPlaying) => set({ isPlaying }),
    select: (selection) => set({ selection }),
    setTimelineZoom: (timelineZoom) => set({ timelineZoom: Math.min(600, Math.max(10, timelineZoom)) }),
    fitTimelineHeightToWindow: () => {
      const timelineHeight = readStoredDockHeight(get().timelineHeight);
      if (timelineHeight !== get().timelineHeight) set({ timelineHeight });
    },
    setTimelineHeight: (h) => {
      const timelineHeight = clampDockHeight(h, typeof window === "undefined" ? undefined : window.innerHeight);
      if (timelineHeight === get().timelineHeight) return;
      storeDockHeight(timelineHeight);
      set({ timelineHeight });
    },
    setCanvasZoom: (canvasZoom) => set({ canvasZoom }),
    setNotice(text) {
      set({ notice: text });
      if (noticeTimer) clearTimeout(noticeTimer);
      if (text) noticeTimer = setTimeout(() => set({ notice: null }), 6000);
    },
    requestEdit(sel) {
      const project = get().project;
      let tool: ToolId = "subtitles";
      if (sel.kind === "overlay") {
        const kind = project?.overlays.find((o) => o.id === sel.id)?.kind;
        tool = kind === "image" || kind === "lottie" ? "picture" : "text";
      } else if (sel.kind === "clip") tool = "trim";
      else if (sel.kind === "voiceover") tool = "music";
      set({ selection: sel, tool, editRequest: { ...sel, nonce: Date.now() } });
    },

    registerAsset(assetId, blob) {
      const url = URL.createObjectURL(blob);
      set((s) => ({ assetUrls: { ...s.assetUrls, [assetId]: url } }));
      return url;
    },
    setImportStatus: (importStatus) => set({ importStatus }),
    setImportError: (importError) => set({ importError }),
    markAssetPending: (assetId) => set((s) => ({ pendingAssetIds: [...s.pendingAssetIds, assetId] })),
    unmarkAssetPending: (assetId) => set((s) => ({ pendingAssetIds: s.pendingAssetIds.filter((id) => id !== assetId) })),

    releaseAsset(assetId) {
      const url = get().assetUrls[assetId];
      if (url) URL.revokeObjectURL(url);
      set((s) => {
        const next = { ...s.assetUrls };
        delete next[assetId];
        return { assetUrls: next };
      });
    },
  })),
);

/** Flushes a pending autosave immediately (used before leaving the editor). */
export async function flushSave() {
  const pending = !!saveTimer || useEditor.getState().saveState !== "saved";
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!pending) return;
  const project = useEditor.getState().project;
  try {
    if (project) {
      await saveProject(project);
      clearJournal(project);
    }
    useEditor.setState({ saveState: "saved" });
  } catch (e) {
    console.error("Autosave failed", e);
    useEditor.setState({ saveState: "dirty" });
  }
}

/**
 * Writes a pending autosave when the page is hidden or unloaded (reload, tab
 * close, quitting the browser); React effect cleanups do not run then, so
 * without this the last half-second of edits is lost. Returns a detach function.
 */
export function attachUnloadFlush(): () => void {
  const hide = () => {
    const { project, saveState } = useEditor.getState();
    if (project && (saveTimer || saveState !== "saved")) writeJournal(project);
    void flushSave();
  };
  const onHide = () => hide();
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hide();
  };
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
