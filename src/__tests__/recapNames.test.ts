import { afterEach, describe, expect, it, vi } from "vitest";
import { loadRecap, saveRecap, saveTitles } from "@/lib/recap/recapNames";

describe("recapNames", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round trips names and closing", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    });

    const projectId = "p1";
    const names = { 0: "Alice", 1: "Bob" };
    const closing = "Bye";
    saveRecap(projectId, { names, closing });
    const loaded = loadRecap(projectId);
    expect(loaded.names).toEqual(names);
    expect(loaded.closing).toBe(closing);
  });

  it("keeps moment names when the other choices are saved, and adds to them", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    });

    saveTitles("p9", { "10": "First" });
    saveRecap("p9", { names: { 0: "Alice" }, closing: "Bye" });
    saveTitles("p9", { "20": "Second" });
    expect(loadRecap("p9")).toEqual({ names: { 0: "Alice" }, closing: "Bye", titles: { "10": "First", "20": "Second" } });
  });

  it("bad JSON gives empty result", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    });

    const projectId = "p2";
    store.set(`reelflow.recap.${projectId}`, "not json");
    const loaded = loadRecap(projectId);
    expect(loaded.names).toEqual({});
    expect(loaded.closing).toBeNull();
  });

  it("no localStorage does not throw", () => {
    vi.stubGlobal("localStorage", undefined);
    const projectId = "p3";
    expect(() => saveRecap(projectId, { names: {}, closing: "x" })).not.toThrow();
    const loaded = loadRecap(projectId);
    expect(loaded.names).toEqual({});
    expect(loaded.closing).toBeNull();
  });

  it("non-string values are dropped", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    });

    const projectId = "p4";
    store.set(`reelflow.recap.${projectId}`, JSON.stringify({
      names: { 0: "Alice", 1: 123, 2: null, 3: "Bob" },
      closing: "End",
    }));
    const loaded = loadRecap(projectId);
    expect(loaded.names).toEqual({ 0: "Alice", 3: "Bob" });
    expect(loaded.closing).toBe("End");
  });
});
