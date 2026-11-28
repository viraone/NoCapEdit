import { create } from "zustand";
import { findLaughs, type Laugh } from "@/lib/recap/findLaughs";
import { makeTrailer } from "@/lib/recap/makeTrailer";
import { useEditor } from "@/store/editorStore";
import { findSets, setAt } from "@/lib/recap/performers";
import { layoutClips } from "@/lib/models/timeline";
import { loadRecap, saveRecap } from "@/lib/recap/recapNames";
import { cutPieces } from "@/lib/recap/cutPieces";
import { clearOpener, loadOpener as loadSavedOpener, parseClock, saveOpener, type Opener } from "@/lib/recap/opener";
import { whileBusy } from "@/lib/utils/busy";

export function recapKey(projectId: string, clips: { id: string; inPoint: number; outPoint: number; speed?: number }[]): string {
  const parts = [projectId];
  for (const c of clips) {
    parts.push(c.id, String(c.inPoint), String(c.outPoint), String(c.speed ?? 1));
  }
  return parts.join("|");
}

interface RecapState {
  key: string;
  laughs: Laugh[] | null;
  job: { message: string; progress: number | null } | null;
  error: string | null;
  kept: string[];
  toggleKeep(id: string): void;
  names: Record<number, string>;
  setName(index: number, name: string): void;
  closing: string;
  setClosing(text: string): void;
  keepOnly(ids: string[]): void;
  /** The opening shot shared by every project, or null when none is saved. */
  opener: Opener | null;
  openerJob: { message: string; progress: number | null } | null;
  openerError: string | null;
  loadOpener(): Promise<void>;
  addOpener(file: File, startText: string, seconds: number): Promise<void>;
  removeOpener(): Promise<void>;
  making: { message: string; progress: number | null } | null;
  trailerId: string | null;
  make(): Promise<void>;
  cancelMake(): void;
  run(): Promise<void>;
  cancel(): void;
}

let currentController: AbortController | null = null;
let runId = 0;
let makeController: AbortController | null = null;
let makeRunId = 0;

export const useRecap = create<RecapState>((set, get) => ({
  key: "",
  laughs: null,
  job: null,
  error: null,
  kept: [],
  toggleKeep: (id) => {
    set((s) => ({
      kept: s.kept.includes(id) ? s.kept.filter((k) => k !== id) : [...s.kept, id],
    }));
  },
  names: {},
  setName: (index, name) => {
    set((s) => {
      const names = { ...s.names, [index]: name };
      const projectId = useEditor.getState().project?.id;
      if (projectId) {
        saveRecap(projectId, { names, closing: s.closing });
      }
      return { names };
    });
  },
  closing: "Like and follow for the next show",
  setClosing: (text) => {
    set((s) => {
      const projectId = useEditor.getState().project?.id;
      if (projectId) {
        saveRecap(projectId, { names: s.names, closing: text });
      }
      return { closing: text };
    });
  },
  keepOnly: (ids) => {
    set({ kept: ids });
  },
  opener: null,
  openerJob: null,
  openerError: null,
  loadOpener: async () => {
    set({ opener: await loadSavedOpener() });
  },
  addOpener: async (file, startText, seconds) => {
    if (get().openerJob) return;
    const start = parseClock(startText);
    if (start === null) {
      set({ openerError: "Start at must be a time like 0:00." });
      return;
    }
    if (!Number.isFinite(seconds) || seconds < 0.5 || seconds > 10) {
      set({ openerError: "Seconds must be between 0.5 and 10." });
      return;
    }
    set({ openerJob: { message: "Opening the video", progress: null }, openerError: null });
    try {
      const cut = await whileBusy(() =>
        cutPieces(file, [{ start, seconds }], {
          onStatus: (message) => set({ openerJob: { message, progress: null } }),
          onProgress: (progress) => set({ openerJob: { message: "Cutting the opening shot", progress } }),
        }),
      );
      const opener: Opener = { name: file.name, blob: cut, seconds };
      await saveOpener(opener);
      set({ opener, openerJob: null });
    } catch (e) {
      set({ openerJob: null, openerError: e instanceof Error ? e.message : String(e) });
    }
  },
  removeOpener: async () => {
    await clearOpener();
    set({ opener: null, openerError: null });
  },
  making: null,
  trailerId: null,
  make: async () => {
    if (get().making || get().job || get().openerJob) return;
    const project = useEditor.getState().project;
    if (!project) return;
    const laughs = get().laughs ?? [];
    const kept = get().kept;
    const keptLaughs = laughs.filter((l) => kept.includes(l.id));
    if (keptLaughs.length === 0) return;

    const duration = layoutClips(project.clips).reduce((max, l) => Math.max(max, l.end), 0);
    const sets = findSets(project.cues ?? [], duration);
    const names = get().names;
    const closing = get().closing;
    const opener = get().opener;

    const controller = new AbortController();
    makeController = controller;
    const myRunId = ++makeRunId;

    set({ making: { message: "Starting", progress: null }, error: null, trailerId: null });

    try {
      const result = await makeTrailer({
        source: project,
        laughs: keptLaughs.map((l) => ({ start: l.start, end: l.end })),
        signal: controller.signal,
        onProgress: (message, progress) => {
          if (myRunId !== makeRunId) return;
          set({ making: { message, progress } });
        },
        nameAt: (t) => {
          const i = setAt(sets, t);
          return i < 0 ? "" : (names[i] ?? sets[i].name);
        },
        closing,
        opener: opener?.blob,
      });
      if (myRunId !== makeRunId) return;
      set({ trailerId: result.id, making: null });
    } catch (e) {
      if (myRunId !== makeRunId) return;
      if (e instanceof DOMException && e.name === "AbortError") {
        set({ making: null });
      } else {
        set({ error: e instanceof Error ? e.message : String(e), making: null });
      }
    } finally {
      if (myRunId === makeRunId) {
        makeController = null;
      }
    }
  },
  cancelMake: () => {
    makeController?.abort();
    makeRunId++;
    set({ making: null });
  },
  run: async () => {
    if (get().job) return;
    const project = useEditor.getState().project;
    if (!project || !project.clips.length) return;

    const key = recapKey(project.id, project.clips);
    const controller = new AbortController();
    currentController = controller;
    const myRunId = ++runId;

    const saved = loadRecap(project.id);
    set({ key, job: { message: "Starting", progress: null }, error: null, laughs: null, kept: [], names: saved.names, closing: saved.closing ?? "Like and follow for the next show", trailerId: null });

    try {
      const laughs = await findLaughs({
        clips: project.clips,
        signal: controller.signal,
        onProgress: (message, progress) => {
          if (myRunId !== runId) return;
          set({ job: { message, progress } });
        },
      });
      if (myRunId !== runId) return;
      set({ laughs, job: null });
    } catch (e) {
      if (myRunId !== runId) return;
      if (e instanceof DOMException && e.name === "AbortError") {
        set({ job: null });
      } else {
        set({ error: e instanceof Error ? e.message : String(e), job: null });
      }
    } finally {
      if (myRunId === runId) {
        currentController = null;
      }
    }
  },
  cancel: () => {
    currentController?.abort();
    // The cancelled run may still report progress (its sound is still being read): ignore it from here.
    runId++;
    set({ job: null });
  },
}));
