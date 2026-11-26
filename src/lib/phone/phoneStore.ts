import { create } from "zustand";
import type { VideoProject } from "@/lib/models/project";

/** The export the Instagram panel offers to post: kept here so it outlives the Export panel that made it. */
export interface FinishedExport {
  /** The MP4 when the export kept it in memory; null when it went straight to a file on disk. */
  video: Blob | null;
  /** Reads back an export that went straight to disk. */
  loadVideo: (() => Promise<Blob>) | null;
  fileName: string;
  bytes: number;
  /** True when it was saved straight to disk, false when it went to Downloads. */
  streamed: boolean;
  /** When it finished; also tells one export from the next. */
  at: number;
  /** The project as it was when the video was made. */
  project: VideoProject;
  /** Made by the Instagram panel itself: not saved as a file. */
  inApp?: boolean;
}

/** The phone panel's state, shared by the top bar button, the phone panel, the Export panel and the Instagram panel. */
interface PhoneState {
  /** The live phone panel is showing. */
  open: boolean;
  setOpen(open: boolean): void;
  lastExport: FinishedExport | null;
  setLastExport(done: FinishedExport | null): void;
  /** The video already copied to the phone, so a second button does not copy it again. */
  sent: { video: Blob; uri: string } | null;
  setSent(sent: { video: Blob; uri: string } | null): void;
  /** Starting the emulator from the app: under way, or why it did not work. Shared, so both Start buttons agree. */
  emulator: { state: "starting"; avd: string } | { state: "failed"; text: string } | null;
  setEmulator(emulator: PhoneState["emulator"]): void;
  /** Goes up when the emulator comes on or goes away, so the panels ask about the phone again. */
  phoneRound: number;
  phoneChanged(): void;
  /** Goes up when the Export panel finishes a video: the Instagram panel starts afresh then. */
  exportRound: number;
  /** Keeps a video the Instagram panel made, without starting the panel afresh. */
  setOwnExport(done: FinishedExport): void;
  /** A video is being made right now: no second export is started. */
  rendering: boolean;
  setRendering(rendering: boolean): void;
}

export const usePhone = create<PhoneState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  lastExport: null,
  setLastExport: (lastExport) => set((s) => ({ lastExport, exportRound: s.exportRound + 1 })),
  sent: null,
  setSent: (sent) => set({ sent }),
  emulator: null,
  setEmulator: (emulator) => set({ emulator }),
  phoneRound: 0,
  phoneChanged: () => set((s) => ({ phoneRound: s.phoneRound + 1 })),
  exportRound: 0,
  setOwnExport: (lastExport) => set({ lastExport }),
  rendering: false,
  setRendering: (rendering) => set({ rendering }),
}));
