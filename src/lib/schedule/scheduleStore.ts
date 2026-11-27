/**
 * Whether the Schedule window is open. The window itself lives in ScheduleHost (desktop app only);
 * the Instagram tool's "Schedule a Story" button opens it with `show()`.
 */
import { create } from "zustand";

interface ScheduleWindowState {
  open: boolean;
  show(): void;
  hide(): void;
}

export const useScheduleWindow = create<ScheduleWindowState>((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
}));
