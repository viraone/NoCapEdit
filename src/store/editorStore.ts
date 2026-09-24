import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import type { VideoProject } from "@/lib/models/project";
import { getProject, listProjectAssets, saveProject } from "@/lib/storage/db";
import { engine } from "@/lib/playback/engine";
import { clampDockHeight, readStoredDockHeight, storeDockHeight } from "@/components/timeline/dockLayout";

export type ToolId = "clips" | "trim" | "subtitles" | "style" | "text" | "picture" | "music" | "export";

export interface Selection {
  kind: "clip" | "cue" | "overlay";
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

  loadProject(id: string): Promise<boolean>;
  unload(): void;
  update(fn: (draft: VideoProject) => void | VideoProject, opts?: { history?: boolean }): void;
  beginTransaction(): void;
  endTransaction(): void;
  undo(): void;
  redo(): void;
  setTool(tool: ToolId): void;
  setTime(t: number): void;
  seek(t: number): void;
  setPlaying(playing: boolean): void;
  select(sel: Selection | null): void;
  setTimelineZoom(z: number): void;
  setTimelineHeight(h: number): void;
  setCanvasZoom(z: CanvasZoom): void;
  setNotice(text: string | null): void;
  /** Selects the element, switches to its panel and asks that panel to focus its editor. */
  requestEdit(sel: Selection): void;
  registerAsset(assetId: string, blob: Blob): string;
  releaseAsset(assetId: string): void;
}

const MAX_HISTORY = 60;
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

    async loadProject(id) {
      get().unload();
      set({ loading: true, error: null });
      try {
        const project = await getProject(id);
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
      set({ project: null, assetUrls: {}, past: [], future: [], txSnapshot: null, selection: null, currentTime: 0, isPlaying: false, editRequest: null });
    },

    update(fn, opts = {}) {
      const { project, past, txSnapshot } = get();
      if (!project) return;
      const draft = structuredClone(project);
      const next = (fn(draft) ?? draft) as VideoProject;
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
      if (project && !txSnapshot) set({ txSnapshot: project });
    },

    endTransaction() {
      const { txSnapshot, past, project } = get();
      if (!txSnapshot) return;
      if (project === txSnapshot) {
        set({ txSnapshot: null });
        return;
      }
      set({ txSnapshot: null, past: [...past.slice(-(MAX_HISTORY - 1)), txSnapshot], future: [] });
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
      set({ selection: sel, tool, editRequest: { ...sel, nonce: Date.now() } });
    },

    registerAsset(assetId, blob) {
      const url = URL.createObjectURL(blob);
      set((s) => ({ assetUrls: { ...s.assetUrls, [assetId]: url } }));
      return url;
    },
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
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const project = useEditor.getState().project;
  if (project) await saveProject(project);
  useEditor.setState({ saveState: "saved" });
}
