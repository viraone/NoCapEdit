import { describe, expect, it } from "vitest";
import { loadStudioModel, studioApiBase, studioAiPatch, isStudioSettings } from "@/lib/edit/studioModel";

describe("studioModel", () => {
  it("loadStudioModel returns null when window is undefined", async () => {
    // In node environment, window is undefined
    const result = await loadStudioModel();
    expect(result).toBeNull();
  });

  it("studioApiBase strips trailing slashes and appends /studio/v1", () => {
    expect(studioApiBase("app://nocap")).toBe("app://nocap/studio/v1");
    expect(studioApiBase("app://nocap/")).toBe("app://nocap/studio/v1");
    expect(studioApiBase("https://example.com")).toBe("https://example.com/studio/v1");
    expect(studioApiBase("https://example.com///")).toBe("https://example.com/studio/v1");
  });

  it("studioAiPatch returns correct settings", () => {
    const studio = { model: "m1", name: "Mac Studio" };
    const origin = "app://nocap";
    const patch = studioAiPatch(studio, origin);
    expect(patch).toEqual({
      provider: "openai",
      apiBase: "app://nocap/studio/v1",
      apiKey: "mac-studio",
      apiModel: "m1",
    });
  });

  it("isStudioSettings detects studio settings", () => {
    const origin = "app://nocap";
    expect(isStudioSettings({ provider: "openai", apiBase: "app://nocap/studio/v1" }, origin)).toBe(true);
    expect(isStudioSettings({ provider: "openai", apiBase: "app://nocap/studio/v1/" }, origin)).toBe(true);
    expect(isStudioSettings({ provider: "openai", apiBase: "https://api.openai.com/v1" }, origin)).toBe(false);
    expect(isStudioSettings({ provider: "ollama", apiBase: "app://nocap/studio/v1" }, origin)).toBe(false);
  });
});
