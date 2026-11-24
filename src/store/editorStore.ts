import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { normalizeProject, type VideoProject } from "@/lib/models/project";
import { rippleTimeline } from "@/lib/models/ripple";
import { reelOnSource } from "@/lib/models/timeline";
import { getProject, listProjectAssets, saveProject } from "@/lib/storage/db";
import { engine } from "@/lib/playback/engine";
import { sameProject } from "@/lib/utils/same";
import { nextRetryDelay } from "@/lib/saveRetry";
import { clampDockHeight, readStoredDockHeight, storeDockHeight } from "@/components/timeline/dockLayout";

export type ToolId = "clips" | "trim" | "subtitles" | "transcript" | "style" | "text" | "picture" | "music" | "reels" | "recap" | "post" | "reframe" | "export";

export interface Selection {
  kind: "clip" | "cue" | "overlay" | "voiceover" | "music";
  /** For music: the number of the selected piece of the song (0 when it is in one piece). */
  id: string;
}

export type CanvasZoom = "fit" | number;

export interface EditorState {
  project: VideoProject | null;
  /** For a reel: the project it was cut from, when that still exists (the timeline stretches the reel from it). */
  sourceProject: VideoProject | null;
  loading: boolean;
  error: string | null;
  past: VideoProject[];
  future: VideoProject[];
  txSnapshot: VideoProject | null;
  /** 'error' means the last autosave write threw; retries are scheduled and the top bar offers Retry now. */
  saveState: "saved" | "saving" | "dirty" | "error";
  /** The unload safety copy could not be written (storage full); cleared by the next successful save. */
  journalFailed: boolean;
  tool: ToolId;
  /** The left tool panel is shown; the X in its corner hides it, picking a tool shows it again. */
  panelOpen: boolean;
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
  /** Set by the Reels panel's "+10 s" buttons; the timeline dock, which owns the stretch, performs it. */
  stretchRequest: { side: "before" | "after"; seconds: number; nonce: number } | null;
  /**
   * A Make reels run is going. It lives in the Reels panel and closing the panel
   * stops it, so tools and links that would close it wait (see holdForReelRun).
   */
  reelRun: boolean;
  /** Bumped by "Make reels" in the top-bar menu; the Subtitles panel runs the job. */
  reelsRequest: number;
  /** Progress line of the video import running in this editor (shared by the top bar and the Clips panel), null when idle. */
  importStatus: string | null;
  /** Files the last import could not add, one "name: reason" per line; shown by the Clips panel. */
  importError: string | null;
  /** Assets already written to IndexedDB by an import whose clip has not joined the project yet. */
  pendingAssetIds: string[];

  loadProject(id: string): Promise<boolean>;
  unload(): void;
  /**
   * Applies an edit to a copy of the project. `history: false` skips the undo
   * step and the no-op check (pointer moves). `ripple`: the edit changes the
   * clip sequence, so captions, text, stickers and voice-overs follow the
   * picture, measured from the state a drag began in.
   */
  update(fn: (draft: VideoProject) => void | VideoProject, opts?: { history?: boolean; ripple?: boolean }): void;
  /** Saves the current project at once, skipping the debounce and any waiting retry (the Retry now button). */
  saveNow(): void;
  /** Opens an undo transaction; false when one is already open (the caller then does not own it). */
  beginTransaction(): boolean;
  /** Closes the transaction; true when it recorded an undo step. */
  endTransaction(): boolean;
  undo(): void;
  redo(): void;
  setTool(tool: ToolId): void;
  setPanelOpen(open: boolean): void;
  setReelRun(on: boolean): void;
  /** True while a Make reels run must not be left, after saying so; callers then stay where they are. */
  holdForReelRun(): boolean;
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
  requestReels(): void;
  /** Asks the timeline to lengthen a one-clip reel by `seconds` of the source video on that side. */
  requestStretch(side: "before" | "after", seconds: number): void;
  registerAsset(assetId: string, blob: Blob): string;
  releaseAsset(assetId: string): void;
  setImportStatus(status: string | null): void;
  setImportError(error: string | null): void;
  markAssetPending(assetId: string): void;
  unmarkAssetPending(assetId: string): void;
}

const MAX_HISTORY = 60;

export { sameProject };

/** Same project content; the save stamp, which every update bumps, is ignored. */
function sameEdit(a: VideoProject, b: VideoProject): boolean {
  return sameProject({ ...a, updatedAt: 0 }, { ...b, updatedAt: 0 });
}

/**
 * Synchronous safety copy of an unsaved project, written when the page is
 * hidden or unloaded. Browsers abandon IndexedDB writes started during unload,
 * so a reload right after an edit would otherwise lose it; the next load
 * restores the copy when it is newer than the stored project.
 */
const JOURNAL_KEY = "reelflow.unsaved";

/** False when the copy could not be written (storage full or unavailable); the caller reports it. */
function writeJournal(project: VideoProject): boolean {
  try {
    localStorage.setItem(JOURNAL_KEY, JSON.stringify(project));
    return true;
  } catch {
    return false;
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
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | null = null;
/** Consecutive failed writes since the last success; drives the retry backoff. */
let retryAttempt = 0;
/** Bumped by unload so a write still in flight for the old project cannot report on (or retry for) the new one. */
let saveGeneration = 0;

type SaveStateSetter = (s: Partial<EditorState>) => void;

function cancelSaveTimers() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

/**
 * Writes the project and reports the outcome. A failed write shows as 'error'
 * and schedules another try; a success resets the backoff and clears the
 * safety copy. Edits that land mid-write are saved by their own (earlier)
 * debounce, so this write only reports 'saved' while it is still the current one.
 */
async function runSave(project: VideoProject, set: SaveStateSetter, generation = saveGeneration) {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  set({ saveState: "saving" });
  try {
    await saveProject(project);
    if (generation !== saveGeneration) return;
    clearJournal(project);
    retryAttempt = 0;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (useEditor.getState().project === project) set({ saveState: "saved", journalFailed: false });
    else set({ saveState: "dirty" });
  } catch (e) {
    if (generation !== saveGeneration) return;
    console.error("Autosave failed", e);
    set({ saveState: "error" });
    scheduleRetry(set);
  }
}

/** Waits nextRetryDelay(attempt), then tries again with whatever the project is by then. */
function scheduleRetry(set: SaveStateSetter) {
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryAttempt += 1;
    const project = useEditor.getState().project;
    if (project) void runSave(project, set);
  }, nextRetryDelay(retryAttempt));
}

function scheduleSave(project: VideoProject, set: SaveStateSetter) {
  if (saveTimer) clearTimeout(saveTimer);
  // A fresh edit is saved sooner than any waiting retry, so drop that one.
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  set({ saveState: "dirty" });
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void runSave(project, set);
  }, 500);
}

export const useEditor = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    project: null,
    sourceProject: null,
    loading: false,
    error: null,
    past: [],
    future: [],
    txSnapshot: null,
    saveState: "saved",
    journalFailed: false,
    tool: "clips",
    panelOpen: true,
    currentTime: 0,
    isPlaying: false,
    selection: null,
    assetUrls: {},
    timelineZoom: 80,
    timelineHeight: readStoredDockHeight(),
    canvasZoom: "fit",
    notice: null,
    editRequest: null,
    stretchRequest: null,
    reelRun: false,
    reelsRequest: 0,
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
        const sourceProject = project.sourceProjectId ? ((await getProject(project.sourceProjectId)) ?? null) : null;
        // The source may have been trimmed since the reel was cut; its ranges follow.
        if (project.reel && sourceProject) project.reel = reelOnSource(project.reel, sourceProject.clips);
        set({ project, sourceProject, assetUrls, loading: false, past: [], future: [], currentTime: 0, isPlaying: false, selection: null, tool: "clips", panelOpen: true });
        return true;
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        return false;
      }
    },

    unload() {
      saveGeneration += 1;
      cancelSaveTimers();
      retryAttempt = 0;
      for (const url of Object.values(get().assetUrls)) URL.revokeObjectURL(url);
      engine.dispose();
      if (noticeTimer) {
        clearTimeout(noticeTimer);
        noticeTimer = null;
      }
      set({ project: null, sourceProject: null, assetUrls: {}, past: [], future: [], txSnapshot: null, selection: null, currentTime: 0, isPlaying: false, editRequest: null, stretchRequest: null, reelRun: false, importStatus: null, importError: null, pendingAssetIds: [], notice: null, saveState: "saved", journalFailed: false });
    },

    update(fn, opts = {}) {
      const { project, past, txSnapshot } = get();
      if (!project) return;
      const draft = structuredClone(project);
      const next = (fn(draft) ?? draft) as VideoProject;
      if (opts.ripple) rippleTimeline(txSnapshot ?? project, next);
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

    saveNow() {
      const { project } = get();
      if (!project) return;
      cancelSaveTimers();
      void runSave(project, set);
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
      // A drag that ends where it began (or snaps back there) records no step.
      if (project === txSnapshot || (project && sameEdit(project, txSnapshot))) {
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

    setTool(tool) {
      if (tool !== "reels" && get().holdForReelRun()) return;
      set({ tool, panelOpen: true });
    },
    setPanelOpen: (panelOpen) => set({ panelOpen }),
    setReelRun: (reelRun) => set({ reelRun }),
    holdForReelRun() {
      if (!get().reelRun) return false;
      get().setNotice("Reels are still being made here. Leaving this panel would stop them: wait for them to finish, or press Cancel first.");
      return true;
    },
    setTime: (currentTime) => set({ currentTime }),
    seek(t) {
      engine.seek(t);
      set({ currentTime: engine.time });
    },
    setPlaying: (isPlaying) => set({ isPlaying }),
    select: (selection) => set({ selection }),
    setTimelineZoom: (timelineZoom) => set({ timelineZoom: Math.min(600, Math.max(1, timelineZoom)) }),
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
    requestStretch(side, seconds) {
      set({ stretchRequest: { side, seconds, nonce: Date.now() } });
    },

    requestReels() {
      // The Reels panel takes it from here: it runs the job, or asks for
      // subtitles first when the project has no captions.
      set({ tool: "reels", panelOpen: true, reelsRequest: Date.now() });
    },
    requestEdit(sel) {
      if (get().holdForReelRun()) return;
      const project = get().project;
      let tool: ToolId = "subtitles";
      if (sel.kind === "overlay") {
        const kind = project?.overlays.find((o) => o.id === sel.id)?.kind;
        tool = kind === "image" || kind === "lottie" ? "picture" : "text";
      } else if (sel.kind === "clip") tool = "trim";
      else if (sel.kind === "voiceover") tool = "music";
      set({ selection: sel, tool, panelOpen: true, editRequest: { ...sel, nonce: Date.now() } });
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
  const { project, saveState } = useEditor.getState();
  const pending = !!saveTimer || !!retryTimer || saveState !== "saved";
  cancelSaveTimers();
  if (!pending) return;
  if (!project) {
    useEditor.setState({ saveState: "saved" });
    return;
  }
  await runSave(project, useEditor.setState);
}

/**
 * Writes a pending autosave when the page is hidden or unloaded (reload, tab
 * close, quitting the browser); React effect cleanups do not run then, so
 * without this the last half-second of edits is lost. Returns a detach function.
 */
export function attachUnloadFlush(): () => void {
  const hide = () => {
    const { project, saveState } = useEditor.getState();
    if (project && (saveTimer || retryTimer || saveState !== "saved") && !writeJournal(project)) {
      // Quota or blocked storage: IndexedDB is now the only copy of this edit,
      // so say so instead of failing silently.
      useEditor.setState({ journalFailed: true });
    }
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
