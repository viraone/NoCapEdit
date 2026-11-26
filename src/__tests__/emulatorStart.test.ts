import { beforeEach, describe, expect, it } from "vitest";
import { avdLabel, emulatorIsOff, startEmulator, watchEmulator } from "@/lib/phone/emulatorStart";
import type { DesktopPhoneBridge, PhoneInfo } from "@/lib/phone/phoneBridge";
import { usePhone } from "@/lib/phone/phoneStore";

const noWait = () => Promise.resolve();

/** A stand-in for the app: `info()` gives these answers in turn, the last one for ever. */
function fakeApi(answers: PhoneInfo[], launch?: () => Promise<{ state: "on" | "starting"; avd: string }>) {
  let asked = 0;
  const launched: (string | undefined)[] = [];
  const api = {
    info: async () => answers[Math.min(asked++, answers.length - 1)],
    launch: async (avd?: string) => {
      launched.push(avd);
      return launch ? launch() : { state: "starting" as const, avd: avd ?? "Pixel_9_API_36" };
    },
  } as unknown as DesktopPhoneBridge;
  return { api, launched, asked: () => asked };
}

describe("starting the emulator from the app", () => {
  beforeEach(() => {
    usePhone.setState({ emulator: null, phoneRound: 0 });
  });

  it("shows a virtual phone's name in plain words", () => {
    expect(avdLabel("Pixel_9_API_36")).toBe("Pixel 9 API 36");
    expect(avdLabel("pixel8")).toBe("pixel8");
  });

  it("offers Start only while the emulator itself is not on", () => {
    expect(emulatorIsOff(null)).toBe(false);
    expect(emulatorIsOff({ available: true, emulator: "on" })).toBe(false);
    expect(emulatorIsOff({ available: false, emulator: "off" })).toBe(true);
    expect(emulatorIsOff({ available: false, emulator: "starting" })).toBe(true);
    // A real phone is plugged in and answering, but the emulator is off: Start is still offered.
    expect(emulatorIsOff({ available: true, emulator: "off" })).toBe(true);
    // An older answer with no emulator state: go by whether a phone answered.
    expect(emulatorIsOff({ available: false })).toBe(true);
    expect(emulatorIsOff({ available: true })).toBe(false);
  });

  it("waits until the emulator is on, then tells the panels", async () => {
    const { api, launched, asked } = fakeApi([
      { available: false, emulator: "starting" },
      { available: false, emulator: "starting" },
      { available: true, emulator: "on" },
    ]);
    const seen: unknown[] = [];
    const stop = usePhone.subscribe((s) => seen.push(s.emulator));
    await startEmulator(api, "pixel8", noWait);
    stop();
    expect(launched).toEqual(["pixel8"]);
    expect(asked()).toBe(3);
    expect(seen).toContainEqual({ state: "starting", avd: "pixel8" });
    expect(usePhone.getState().emulator).toBeNull();
    expect(usePhone.getState().phoneRound).toBe(1);
  });

  it("says why when the emulator closes before it is on", async () => {
    const { api } = fakeApi([{ available: false, emulator: "off", launchError: "Not enough disk space." }]);
    await watchEmulator(api, "pixel8", noWait);
    expect(usePhone.getState().emulator).toEqual({ state: "failed", text: "Not enough disk space." });
    expect(usePhone.getState().phoneRound).toBe(1);
  });

  it("shows the app's own message when the start is refused, without the wrapper text", async () => {
    const { api, asked } = fakeApi([{ available: false, emulator: "off" }], async () => {
      throw new Error("Error invoking remote method 'phone:launch': Error: No virtual phone is set up yet.");
    });
    await startEmulator(api, undefined, noWait);
    expect(usePhone.getState().emulator).toEqual({ state: "failed", text: "No virtual phone is set up yet." });
    expect(asked()).toBe(0);
  });

  it("does nothing more when the emulator turns out to be on already", async () => {
    const { api, asked } = fakeApi([{ available: true, emulator: "on" }], async () => ({ state: "on", avd: "Pixel_9_API_36" }));
    await startEmulator(api, undefined, noWait);
    expect(usePhone.getState().emulator).toBeNull();
    expect(usePhone.getState().phoneRound).toBe(1);
    expect(asked()).toBe(0);
  });
});
