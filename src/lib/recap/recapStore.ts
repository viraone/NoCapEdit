import { create } from "zustand";
import { findLaughs, type Laugh } from "@/lib/recap/findLaughs";
import { useEditor } from "@/store/editorStore";

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
  run(): Promise<void>;
  cancel(): void;
}

let currentController: AbortController | null = null;
let runId = 0;

export const useRecap = create<RecapState>((set, get) => ({
  key: "",
  laughs: null,
  job: null,
  error: null,
  run: async () => {
    if (get().job) return;
    const project = useEditor.getState().project;
    if (!project || !project.clips.length) return;

    const key = recapKey(project.id, project.clips);
    const controller = new AbortController();
    currentController = controller;
    const myRunId = ++runId;

    set({ key, job: { message: "Starting", progress: null }, error: null, laughs: null });

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
