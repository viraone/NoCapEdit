import type { DesktopPhoneBridge, PhoneInfo } from "./phoneBridge";
import { usePhone } from "./phoneStore";

/** How often the app is asked whether the emulator is on yet. */
export const EMULATOR_POLL_MS = 2000;
/** How long "starting" stays on screen after the emulator is on, while the panels ask about the phone again. */
const SETTLE_MS = 1200;
/** After this long the wait stops and says so; the emulator may still come up by itself. */
export const EMULATOR_GIVE_UP_MS = 5 * 60_000;

/** A virtual phone's name as people read it: "Pixel_9_API_36" is shown as "Pixel 9 API 36". */
export const avdLabel = (name: string) => name.replace(/_+/g, " ").trim();

/** True when the Start button belongs on screen: the emulator itself is not on. */
export function emulatorIsOff(info: PhoneInfo | null): boolean {
  if (!info) return false;
  return info.emulator ? info.emulator !== "on" : !info.available;
}

const clean = (e: unknown) => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") : "The emulator could not be started.");

let watching = false;

/**
 * Waits for an emulator that is starting up, asking every two seconds, and tells the panels when
 * it is on (or that it went away). One wait at a time, whichever button began it.
 */
export async function watchEmulator(api: DesktopPhoneBridge, avd: string, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<void> {
  if (watching) return;
  watching = true;
  const phone = usePhone.getState;
  phone().setEmulator({ state: "starting", avd });
  const began = Date.now();
  try {
    for (;;) {
      await sleep(EMULATOR_POLL_MS);
      const info = await api.info().catch(() => null);
      if (info?.emulator === "on") {
        // The panels ask about the phone first; "starting" stays up until they have their answer,
        // so the Off card never flashes back in between.
        phone().phoneChanged();
        await sleep(SETTLE_MS);
        phone().setEmulator(null);
        return;
      }
      if (info?.emulator === "off") {
        phone().setEmulator({ state: "failed", text: info.launchError ?? "The emulator closed before it finished starting." });
        break;
      }
      if (Date.now() - began > EMULATOR_GIVE_UP_MS) {
        phone().setEmulator({ state: "failed", text: "The emulator is taking more than five minutes. Look at its own window, then check again." });
        break;
      }
    }
  } finally {
    watching = false;
  }
  phone().phoneChanged();
}

/** The Start button: starts the virtual phone (the one used last when no name is given), then waits for it. */
export async function startEmulator(api: DesktopPhoneBridge, avd?: string, sleep?: (ms: number) => Promise<void>): Promise<void> {
  if (watching) return;
  const phone = usePhone.getState;
  phone().setEmulator({ state: "starting", avd: avd ?? "" });
  try {
    const started = await api.launch(avd);
    if (started.state === "on") {
      phone().setEmulator(null);
      phone().phoneChanged();
      return;
    }
    await watchEmulator(api, started.avd || avd || "", sleep);
  } catch (e) {
    phone().setEmulator({ state: "failed", text: clean(e) });
  }
}
