import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/db", () => ({ saveProject: vi.fn(async () => {}), getProject: vi.fn(), listProjectAssets: vi.fn() }));

const db = await import("@/lib/storage/db");
const { useEditor, flushSave, attachUnloadFlush } = await import("@/store/editorStore");
const { createProject } = await import("@/lib/models/project");

describe("autosave flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(db.saveProject).mockClear();
    useEditor.setState({ project: createProject({ name: "a" }), saveState: "saved", past: [], future: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("writes a pending edit at once and cancels the debounce", async () => {
    useEditor.getState().update((p) => void (p.name = "x"));
    expect(db.saveProject).not.toHaveBeenCalled();
    expect(useEditor.getState().saveState).toBe("dirty");
    await flushSave();
    expect(db.saveProject).toHaveBeenCalledTimes(1);
    expect(vi.mocked(db.saveProject).mock.calls[0][0].name).toBe("x");
    expect(useEditor.getState().saveState).toBe("saved");
    vi.advanceTimersByTime(600);
    expect(db.saveProject).toHaveBeenCalledTimes(1);
  });

  it("does nothing when everything is saved", async () => {
    await flushSave();
    expect(db.saveProject).not.toHaveBeenCalled();
  });

  it("flushes on pagehide and when the page is hidden, until detached", async () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "hidden" });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", doc);
    const detach = attachUnloadFlush();
    useEditor.getState().update((p) => void (p.name = "y"));
    window.dispatchEvent(new Event("pagehide"));
    await vi.waitFor(() => expect(db.saveProject).toHaveBeenCalledTimes(1));
    useEditor.getState().update((p) => void (p.name = "z"));
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(db.saveProject).toHaveBeenCalledTimes(2));
    detach();
    useEditor.getState().update((p) => void (p.name = "w"));
    window.dispatchEvent(new Event("pagehide"));
    await Promise.resolve();
    expect(db.saveProject).toHaveBeenCalledTimes(2);
  });

  it("tracks in-flight import assets and resets import state on unload", () => {
    const s = useEditor.getState();
    s.setImportStatus("Reading a.mp4 (1/1)");
    s.markAssetPending("a1");
    s.markAssetPending("a2");
    s.unmarkAssetPending("a1");
    expect(useEditor.getState().pendingAssetIds).toEqual(["a2"]);
    useEditor.getState().unload();
    expect(useEditor.getState().importStatus).toBeNull();
    expect(useEditor.getState().pendingAssetIds).toEqual([]);
  });
});
