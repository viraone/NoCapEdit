import { describe, expect, it } from "vitest";
import { avdImageDir, emulatorStatus, launchFailure, parseAvdList, pickAvd } from "../../desktop/lib/phone.mjs";

describe("starting the emulator", () => {
  it("parses the AVD list", () => {
    expect(parseAvdList("Pixel_9_API_36\npixel8\n")).toEqual(["Pixel_9_API_36", "pixel8"]);
    expect(parseAvdList("Pixel_9_API_36\r\npixel8\r\n")).toEqual(["Pixel_9_API_36", "pixel8"]);
    expect(
      parseAvdList("Pixel_9_API_36\nINFO    | Storing crashdata in: /tmp/x\n\npixel8\n"),
    ).toEqual(["Pixel_9_API_36", "pixel8"]);
    expect(parseAvdList("Pixel_9_API_36\nPixel_9_API_36\n")).toEqual(["Pixel_9_API_36"]);
    expect(parseAvdList("")).toEqual([]);
  });

  it("picks the AVD to start", () => {
    const avds = ["Pixel_9_API_36", "pixel8"];
    expect(pickAvd(avds, "pixel8", "Pixel_9_API_36")).toBe("pixel8");
    expect(pickAvd(avds, "missing", "Pixel_9_API_36")).toBe("Pixel_9_API_36");
    expect(pickAvd(avds, "missing", "missing")).toBe("Pixel_9_API_36");
    expect(pickAvd([], "asked", "remembered")).toBeNull();
  });

  it("reads the emulator status", () => {
    expect(emulatorStatus("List of devices attached\nemulator-5554\tdevice\n")).toEqual({
      serial: "emulator-5554",
      state: "ready",
    });
    expect(emulatorStatus("List of devices attached\nG0W0XJ0\tdevice\nemulator-5554\toffline\n")).toEqual({
      serial: "emulator-5554",
      state: "starting",
    });
    expect(emulatorStatus("List of devices attached\nG0W0XJ0\tdevice\n")).toEqual({
      serial: null,
      state: "none",
    });
    expect(emulatorStatus("emulator-5554\toffline\nemulator-5556\tdevice\n")).toEqual({
      serial: "emulator-5556",
      state: "ready",
    });
    expect(emulatorStatus("")).toEqual({ serial: null, state: "none" });
  });

  it("explains why the emulator closed", () => {
    expect(
      launchFailure(
        "INFO    | Android emulator version 37\nERROR   | Running multiple emulators with the same AVD is an experimental feature.\nINFO    | bye\n",
      ),
    ).toBe("That phone is already open in another emulator window.");
    expect(launchFailure("INFO    | start\nERROR   | Not enough space to create userdata partition.\nINFO    | bye\n")).toBe("Not enough space to create userdata partition.");
    expect(launchFailure("INFO    | first\nINFO    | last line")).toBe("last line");
    expect(launchFailure("")).toBe("The emulator closed right after it was started.");
    const long = "ERROR   | " + "x".repeat(500);
    expect(launchFailure(long).length).toBe(200);
  });
  it("reads which system image a virtual phone runs", () => {
    expect(avdImageDir("hw.ramSize=2G\nimage.sysdir.1=system-images/android-35/google_apis_playstore/arm64-v8a/\n")).toBe("system-images/android-35/google_apis_playstore/arm64-v8a");
    expect(avdImageDir("image.sysdir.1 = system-images\\android-36\\google_apis\\arm64-v8a\\\r\n")).toBe("system-images/android-36/google_apis/arm64-v8a");
    expect(avdImageDir("hw.ramSize=2G\n")).toBeNull();
    // Never a folder outside the SDK.
    expect(avdImageDir("image.sysdir.1=/etc/\n")).toBeNull();
    expect(avdImageDir("image.sysdir.1=system-images/../../secret\n")).toBeNull();
  });
});
