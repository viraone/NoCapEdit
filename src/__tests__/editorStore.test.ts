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

  it("keeps a synchronous copy on pagehide and restores it on the next load when newer", async () => {
    const mem = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", Object.assign(new EventTarget(), { visibilityState: "visible" }));
    // IndexedDB never completes during unload: the save promise hangs.
    vi.mocked(db.saveProject).mockImplementationOnce(() => new Promise(() => {}));
    const stored = useEditor.getState().project!;
    const detach = attachUnloadFlush();
    vi.setSystemTime(Date.now() + 1000); // the edit is newer than the stored copy
    useEditor.getState().update((p) => void (p.name = "edited"));
    window.dispatchEvent(new Event("pagehide"));
    detach();
    expect(JSON.parse(mem.get("reelflow.unsaved")!).name).toBe("edited");

    vi.mocked(db.getProject).mockResolvedValueOnce(stored);
    vi.mocked(db.listProjectAssets).mockResolvedValueOnce([]);
    vi.mocked(db.saveProject).mockClear();
    await useEditor.getState().loadProject(stored.id);
    expect(useEditor.getState().project?.name).toBe("edited");
    expect(db.saveProject).toHaveBeenCalledTimes(1);
    expect(mem.has("reelflow.unsaved")).toBe(false);

    // An older copy never overrides newer stored data.
    mem.set("reelflow.unsaved", JSON.stringify({ ...stored, name: "old", updatedAt: stored.updatedAt - 1000 }));
    vi.mocked(db.getProject).mockResolvedValueOnce({ ...stored, name: "newer" });
    vi.mocked(db.listProjectAssets).mockResolvedValueOnce([]);
    await useEditor.getState().loadProject(stored.id);
    expect(useEditor.getState().project?.name).toBe("newer");
    expect(mem.has("reelflow.unsaved")).toBe(false);
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
