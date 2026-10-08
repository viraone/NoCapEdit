import { describe, it, expect } from "vitest";
import { isDesktopChrome } from "@/lib/ai/browser";

const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

describe("isDesktopChrome", () => {
  it("accepts desktop Chrome", () => {
    expect(isDesktopChrome(CHROME)).toBe(true);
    expect(isDesktopChrome(CHROME, [{ brand: "Chromium" }, { brand: "Google Chrome" }])).toBe(true);
  });
  it("refuses Edge, Opera, Brave and Chromium-only builds", () => {
    expect(isDesktopChrome(`${CHROME} Edg/140.0`)).toBe(false);
    expect(isDesktopChrome(`${CHROME} OPR/120.0`)).toBe(false);
    expect(isDesktopChrome(CHROME, [{ brand: "Chromium" }, { brand: "Microsoft Edge" }])).toBe(false);
    expect(isDesktopChrome(CHROME, [{ brand: "Chromium" }, { brand: "Brave" }])).toBe(false);
    expect(isDesktopChrome(CHROME, [{ brand: "Chromium" }])).toBe(false);
  });
  it("refuses Safari, Firefox and phones", () => {
    expect(isDesktopChrome("Mozilla/5.0 (Macintosh) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15")).toBe(false);
    expect(isDesktopChrome("Mozilla/5.0 (Macintosh; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe(false);
    expect(isDesktopChrome(CHROME.replace("Macintosh; Intel Mac OS X 10_15_7", "Linux; Android 14; Pixel 8") + " Mobile")).toBe(false);
    expect(isDesktopChrome("Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 CriOS/140.0 Mobile/15E148 Safari/604.1")).toBe(false);
  });
});
