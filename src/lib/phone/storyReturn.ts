/**
 * "Back to Instagram" in the Text tool (desktop app): remembers which project's Story window
 * opened the tool, so the Text panel offers the way back only for that project.
 */
import { create } from "zustand";

interface StoryReturnState {
  projectId: string | null;
  /** The Text tool was opened from the Story window of this project. */
  arrive(projectId: string): void;
  /** The Instagram panel is showing again, or the tool was left some other way. */
  leave(): void;
}

export const useStoryReturn = create<StoryReturnState>((set) => ({
  projectId: null,
  arrive: (projectId) => set({ projectId }),
  leave: () => set({ projectId: null }),
}));
