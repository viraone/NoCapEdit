import { afterEach, describe, expect, it, vi } from "vitest";
import { NOTES_APPS_SCRIPT, NOTES_CACHE_KEY, addNote, fetchNotes, formatNoteDate, isScriptUrl, loadCachedNotes, mergeNotes, parseNotes, syncNotes, type Note } from "@/lib/notes/sheetNotes";

const URL_OK = "https://script.google.com/macros/s/AKfycbx_12-ab/exec";

function answer(data: unknown): Promise<Response> {
  return Promise.resolve(new Response(typeof data === "string" ? data : JSON.stringify(data)));
}

function fakeStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isScriptUrl", () => {
  it("accepts a deployed web app link", () => {
    expect(isScriptUrl(URL_OK)).toBe(true);
    expect(isScriptUrl(`  ${URL_OK}  `)).toBe(true);
    expect(isScriptUrl("https://script.google.com/a/macros/example.com/s/AKfy/exec")).toBe(true);
  });
  it("refuses anything else", () => {
    expect(isScriptUrl("https://script.google.com/macros/s/AKfycbx_12-ab/dev")).toBe(false);
    expect(isScriptUrl("https://docs.google.com/spreadsheets/d/abc/edit")).toBe(false);
    expect(isScriptUrl("http://script.google.com/macros/s/AKfy/exec")).toBe(false);
    expect(isScriptUrl("")).toBe(false);
  });
});

describe("parseNotes", () => {
  it("keeps the rows that are notes", () => {
    const notes = parseNotes([{ date: "2026-11-19T16:18:00.000Z", text: "USB stands for: universal serial bus" }, { text: "  " }, null, { date: 5, text: "no date" }]);
    expect(notes).toEqual([
      { id: "s_0", date: "2026-11-19T16:18:00.000Z", text: "USB stands for: universal serial bus", saved: true },
      { id: "s_3", date: "", text: "no date", saved: true },
    ]);
  });
  it("is empty for anything that is not a list", () => {
    expect(parseNotes("x")).toEqual([]);
    expect(parseNotes(undefined)).toEqual([]);
  });
});

describe("mergeNotes", () => {
  it("puts the sheet's rows first, then the unsaved ones", () => {
    const sheet: Note[] = [{ id: "s_0", date: "a", text: "one", saved: true }];
    const local: Note[] = [
      { id: "n_1", date: "b", text: "old copy", saved: true },
      { id: "n_2", date: "c", text: "waiting", saved: false },
    ];
    expect(mergeNotes(sheet, local).map((n) => n.id)).toEqual(["s_0", "n_2"]);
  });
});

describe("formatNoteDate", () => {
  it("leaves text that is not a date alone", () => {
    expect(formatNoteDate("not a date")).toBe("not a date");
    expect(formatNoteDate("")).toBe("");
  });
  it("shortens a real date", () => {
    expect(formatNoteDate("2026-11-19T16:18:00.000Z")).not.toBe("2026-11-19T16:18:00.000Z");
  });
});

describe("addNote", () => {
  it("posts the note as plain text and returns the sheet's date", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = ((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return answer({ ok: true, date: "2026-11-19T16:18:05.000Z" });
    }) as unknown as typeof fetch;
    expect(await addNote(URL_OK, "USB stands for: universal serial bus", fetchFn)).toBe("2026-11-19T16:18:05.000Z");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(URL_OK);
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toEqual({ "Content-Type": "text/plain;charset=utf-8" });
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ note: "USB stands for: universal serial bus" });
  });
  it("passes on the script's own error", async () => {
    const fetchFn = (() => answer({ ok: false, error: "The note was empty." })) as unknown as typeof fetch;
    await expect(addNote(URL_OK, "x", fetchFn)).rejects.toThrow("The note was empty.");
  });
  it("explains a page that is not the script", async () => {
    const fetchFn = (() => answer("<html>Sign in</html>")) as unknown as typeof fetch;
    await expect(addNote(URL_OK, "x", fetchFn)).rejects.toThrow(/did not answer/);
  });
  it("explains a failed request", async () => {
    const fetchFn = (() => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    await expect(addNote(URL_OK, "x", fetchFn)).rejects.toThrow(/Could not reach Google/);
  });
});

describe("fetchNotes", () => {
  it("returns the notes and the sheet's link", async () => {
    const fetchFn = (() => answer({ ok: true, notes: [{ date: "2026-11-18T10:00:00.000Z", text: "first" }], sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" })) as unknown as typeof fetch;
    expect(await fetchNotes(URL_OK, fetchFn)).toEqual({
      notes: [{ id: "s_0", date: "2026-11-18T10:00:00.000Z", text: "first", saved: true }],
      sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit",
    });
  });
  it("drops a link that is not a Google Sheet", async () => {
    const fetchFn = (() => answer({ ok: true, notes: [], sheetUrl: "https://example.com/x" })) as unknown as typeof fetch;
    expect((await fetchNotes(URL_OK, fetchFn)).sheetUrl).toBe("");
  });
});

describe("syncNotes", () => {
  it("reads the sheet, then sends the note it does not have", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("localStorage", storage);
    storage.setItem(NOTES_CACHE_KEY, JSON.stringify([{ id: "n_1", date: "2026-11-19T10:00:00.000Z", text: "later", saved: false }]));
    const fetchFn = ((_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? answer({ ok: true, date: "2026-11-19T10:00:05.000Z" })
        : answer({ ok: true, notes: [{ date: "2026-11-18T10:00:00.000Z", text: "first" }], sheetUrl: "https://docs.google.com/spreadsheets/d/abc/edit" })) as unknown as typeof fetch;
    const seen: Note[][] = [];
    const link = await syncNotes(URL_OK, (n) => seen.push(n), fetchFn);
    expect(link).toBe("https://docs.google.com/spreadsheets/d/abc/edit");
    expect(seen).toHaveLength(2);
    expect(loadCachedNotes()).toEqual([
      { id: "s_0", date: "2026-11-18T10:00:00.000Z", text: "first", saved: true },
      { id: "n_1", date: "2026-11-19T10:00:05.000Z", text: "later", saved: true },
    ]);
  });
});

describe("NOTES_APPS_SCRIPT", () => {
  it("has both entry points and the two headers", () => {
    expect(NOTES_APPS_SCRIPT).toContain("function doPost(e)");
    expect(NOTES_APPS_SCRIPT).toContain("function doGet()");
    expect(NOTES_APPS_SCRIPT).toContain("['Date', 'Note']");
    expect(NOTES_APPS_SCRIPT).toContain("/^[=+@'-]/");
  });
});
