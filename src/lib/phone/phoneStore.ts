import { create } from "zustand";

/** The phone panel's state, shared by the top bar button, the panel and the Export panel. */
interface PhoneState {
  /** The live phone panel is showing. */
  open: boolean;
  setOpen(open: boolean): void;
}

export const usePhone = create<PhoneState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
