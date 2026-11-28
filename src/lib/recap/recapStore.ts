import { create } from "zustand";
import { findLaughs, type Laugh } from "@/lib/recap/findLaughs";
import { makeTrailer } from "@/lib/recap/makeTrailer";
import { useEditor } from "@/store/editorStore";
import { findSets, setAt } from "@/lib/recap/performers";
import { layoutClips } from "@/lib/models/timeline";
import { loadRecap, saveRecap, saveTitles } from "@/lib/recap/recapNames";
import { batches, matchTitles, momentText, titleKey } from "@/lib/recap/clipTitles";
import { cutPieces } from "@/lib/recap/cutPieces";
import { clearOpener, loadOpener as loadSavedOpener, parseClock, saveOpener, type Opener } from "@/lib/recap/opener";
import { whileBusy } from "@/lib/utils/busy";
import { keptRanges, type MomentEdit } from "@/lib/recap/momentEdits";

export function recapKey(projectId: string, clips: { id: string; inPoint: number; outPoint: number; speed?: number }[]): string {
  const parts = [projectId];
  for (const c of clips) {
    parts.push(c.id, String(c.inPoint), String(c.outPoint), String(c.speed ?? 1));
  }
  return parts.join("|");
}

type Namer = (texts: string[]) => Promise<{ titles: string[]; by: "Mac Studio" | "DeepSeek" }>;

/** The desktop app's naming call (desktop/captionAi.mjs); null on the website. */
function namer(): Namer | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { nocapDesktop?: { caption?: { titles?: Namer } } }).nocapDesktop?.caption?.titles ?? null;
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
  edits: Record<string, MomentEdit>;
  setEdit(id: string, edit: MomentEdit | null): void;
  /** A short name for each moment, by laugh id. */
  titles: Record<string, string>;
  naming: { done: number; total: number } | null;
  /** Who made the names just asked for. */
  namedBy: ("Mac Studio" | "DeepSeek")[];
  namingError: string | null;
  /** Names the moments that have none yet. Needs captions and the desktop app. */
  nameClips(): Promise<void>;
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
    const edits = get().edits;

    const ranges = keptRanges(keptLaughs, edits, project.cues ?? [], duration);

    const controller = new AbortController();
    makeController = controller;
    const myRunId = ++makeRunId;

    set({ making: { message: "Starting", progress: null }, error: null, trailerId: null });

    try {
      const result = await makeTrailer({
        source: project,
        laughs: keptLaughs.map((l) => ({ start: l.start, end: l.end })),
        ranges,
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
    set({ key, job: { message: "Starting", progress: null }, error: null, laughs: null, kept: [], names: saved.names, closing: saved.closing ?? "Like and follow for the next show", trailerId: null, edits: {}, titles: {}, naming: null, namedBy: [], namingError: null });

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
      void get().nameClips();
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
  titles: {},
  naming: null,
  namedBy: [],
  namingError: null,
  nameClips: async () => {
    const project = useEditor.getState().project;
    const laughs = get().laughs;
    const ask = namer();
    if (!ask || !project || !laughs?.length || get().naming) return;
    const cues = project.cues ?? [];
    if (!cues.length) return;

    // Names already made for this project are kept: only the rest are asked for.
    const titles = matchTitles(laughs, loadRecap(project.id).titles);
    const wanted = laughs
      .filter((l) => !titles[l.id])
      .map((laugh) => ({ laugh, text: momentText(laugh, cues) }))
      .filter((w) => w.text);
    set({ titles, namingError: null });
    if (!wanted.length) return;

    const myRunId = runId;
    set({ naming: { done: 0, total: wanted.length } });
    try {
      let done = 0;
      for (const group of batches(wanted, 10)) {
        const reply = await ask(group.map((w) => w.text));
        if (myRunId !== runId) return;
        const fresh: Record<string, string> = {};
        const keep: Record<string, string> = {};
        group.forEach(({ laugh }, i) => {
          const title = reply.titles[i];
          if (!title) return;
          fresh[laugh.id] = title;
          keep[titleKey(laugh)] = title;
        });
        saveTitles(project.id, keep);
        done += group.length;
        set((s) => ({
          titles: { ...s.titles, ...fresh },
          namedBy: s.namedBy.includes(reply.by) ? s.namedBy : [...s.namedBy, reply.by],
          naming: { done, total: wanted.length },
        }));
      }
      set({ naming: null });
    } catch (e) {
      if (myRunId !== runId) return;
      const why = e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : String(e);
      set({ naming: null, namingError: why });
    }
  },
  edits: {},
  setEdit: (id, edit) => {
    set((s) => {
      const edits = { ...s.edits };
      if (edit === null) {
        delete edits[id];
      } else {
        edits[id] = edit;
      }
      return { edits };
    });
  },
}));
