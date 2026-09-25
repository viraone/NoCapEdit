import { describe, expect, it, vi } from "vitest";
import { setSingleThreadPreference, subscribeSingleThreadPreference } from "@/lib/ffmpeg/loader";

describe("single-thread preference subscription", () => {
  it("notifies subscribers on every change, even when storage is unavailable, until unsubscribed", () => {
    const cb = vi.fn();
    const off = subscribeSingleThreadPreference(cb);
    setSingleThreadPreference(true);
    setSingleThreadPreference(false);
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setSingleThreadPreference(true);
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("never lets a throwing listener break the caller", () => {
    const bad = () => {
      throw new Error("listener failed");
    };
    const good = vi.fn();
    const off1 = subscribeSingleThreadPreference(bad);
    const off2 = subscribeSingleThreadPreference(good);
    expect(() => setSingleThreadPreference(false)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    off1();
    off2();
  });
});
