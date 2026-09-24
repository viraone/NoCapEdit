"use client";
import { useSyncExternalStore } from "react";
import { lastMlDevice, type MlDevice } from "@/lib/speech/mlDevice";

const noSubscribe = () => () => {};

/**
 * Compute backend an on-device ML task last ran on (null until known, and
 * null in the pre-rendered HTML so hydration matches). Re-read on every
 * render, so a panel that re-renders when its job finishes shows the update.
 */
export function useMlDevice(task: string): MlDevice | null {
  return useSyncExternalStore(noSubscribe, () => lastMlDevice(task), () => null);
}
