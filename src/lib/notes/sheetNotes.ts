/**
 * Notes typed in the editor, kept in a Google Sheet. The sheet's owner pastes
 * NOTES_APPS_SCRIPT into Extensions > Apps Script and deploys it as a web app;
 * the editor then talks to that web app's link. The link stays in this browser.
 */

export const NOTES_URL_KEY = "reelflow.notes.url";
export const NOTES_CACHE_KEY = "reelflow.notes.cache";
export const NOTES_OPEN_KEY = "reelflow.notes.open";

export interface Note {
  id: string;
  /** ISO time the note was written (the sheet's own time once saved). */
  date: string;
  text: string;
  /** False while the note has not reached the sheet. */
  saved: boolean;
}

export interface SheetNotes {
  notes: Note[];
  sheetUrl: string;
}

type FetchFn = typeof fetch;

/** The script the owner pastes into the sheet. It has no backslashes and no backticks on purpose. */
export const NOTES_APPS_SCRIPT = `// NoCap Edit notes. Paste this into Extensions > Apps Script on your Google Sheet,
// then Deploy > New deployment > Web app (Execute as: Me, Who has access: Anyone).
function notesSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(['Date', 'Note']);
  return sheet;
}

function reply_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Adds one row: the date (filled in here) and the note.
function doPost(e) {
  var note = '';
  try {
    note = String(JSON.parse(e.postData.contents).note || '').trim();
  } catch (err) {
    note = '';
  }
  if (!note) return reply_({ ok: false, error: 'The note was empty.' });
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = notesSheet_();
    var row = sheet.getLastRow() + 1;
    var date = new Date();
    // The note is stored as plain text, so one that starts like a formula stays words.
    var cell = sheet.getRange(row, 2);
    cell.setNumberFormat('@');
    cell.setValue(/^[=+@'-]/.test(note) ? "'" + note : note);
    sheet.getRange(row, 1).setValue(date);
    return reply_({ ok: true, date: date.toISOString() });
  } finally {
    lock.releaseLock();
  }
}

// Lists the notes already in the sheet.
function doGet() {
  var sheet = notesSheet_();
  var last = sheet.getLastRow();
  var rows = last > 1 ? sheet.getRange(2, 1, last - 1, 2).getValues() : [];
  var notes = [];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][1] === '') continue;
    var d = rows[i][0];
    notes.push({ date: d instanceof Date ? d.toISOString() : String(d), text: String(rows[i][1]) });
  }
  return reply_({ ok: true, notes: notes, sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl() });
}
`;

/** True for a deployed Apps Script web app link (the one that ends in /exec). */
export function isScriptUrl(url: string): boolean {
  return /^https:\/\/script\.google\.com\/(a\/macros\/[\w.-]+|macros)\/s\/[\w-]+\/exec$/.test(url.trim());
}

export function newNoteId(): string {
  return `n_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The rows the sheet sent back, as notes; anything that is not a note is dropped. */
export function parseNotes(raw: unknown): Note[] {
  if (!Array.isArray(raw)) return [];
  const notes: Note[] = [];
  raw.forEach((item, i) => {
    if (!item || typeof item !== "object") return;
    const { date, text } = item as { date?: unknown; text?: unknown };
    if (typeof text !== "string" || !text.trim()) return;
    notes.push({ id: `s_${i}`, date: typeof date === "string" ? date : "", text, saved: true });
  });
  return notes;
}

/** The sheet's rows, then the notes that have not reached it yet. */
export function mergeNotes(sheet: Note[], local: Note[]): Note[] {
  return [...sheet, ...local.filter((n) => !n.saved)];
}

export function formatNoteDate(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const NO_ANSWER = "The sheet did not answer. In Apps Script, deploy the script as a Web app with access set to Anyone, then paste the link that ends in /exec.";

async function ask(url: string, init: RequestInit | undefined, fetchFn: FetchFn): Promise<Record<string, unknown>> {
  let body: string;
  try {
    const res = await fetchFn(url.trim(), init);
    body = await res.text();
  } catch {
    throw new Error("Could not reach Google. Check your connection and the link.");
  }
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(NO_ANSWER);
  }
  if (!data || typeof data !== "object") throw new Error(NO_ANSWER);
  const answer = data as Record<string, unknown>;
  if (answer.ok !== true) throw new Error(typeof answer.error === "string" ? answer.error : NO_ANSWER);
  return answer;
}

/** Adds one row to the sheet and returns the date the sheet gave it. */
export async function addNote(url: string, text: string, fetchFn: FetchFn = fetch): Promise<string> {
  // text/plain keeps the browser from sending a preflight, which Apps Script does not answer.
  const answer = await ask(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ note: text }) }, fetchFn);
  return typeof answer.date === "string" ? answer.date : new Date().toISOString();
}

export async function fetchNotes(url: string, fetchFn: FetchFn = fetch): Promise<SheetNotes> {
  const answer = await ask(url, undefined, fetchFn);
  const sheetUrl = typeof answer.sheetUrl === "string" && answer.sheetUrl.startsWith("https://docs.google.com/") ? answer.sheetUrl : "";
  return { notes: parseNotes(answer.notes), sheetUrl };
}

function read(key: string): string {
  try {
    return typeof localStorage === "undefined" ? "" : (localStorage.getItem(key) ?? "");
  } catch {
    return "";
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // Storage is off or full; the note still shows until the page closes.
  }
}

export function loadNotesUrl(): string {
  return read(NOTES_URL_KEY);
}

export function saveNotesUrl(url: string): void {
  write(NOTES_URL_KEY, url.trim());
}

export function loadNotesOpen(): boolean {
  return read(NOTES_OPEN_KEY) !== "0";
}

export function saveNotesOpen(open: boolean): void {
  write(NOTES_OPEN_KEY, open ? "1" : "0");
}

export function loadCachedNotes(): Note[] {
  try {
    const raw: unknown = JSON.parse(read(NOTES_CACHE_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((n): n is Note => {
      if (!n || typeof n !== "object") return false;
      const note = n as Partial<Note>;
      return typeof note.id === "string" && typeof note.text === "string" && typeof note.date === "string" && typeof note.saved === "boolean";
    });
  } catch {
    return [];
  }
}

export function saveCachedNotes(notes: Note[]): void {
  write(NOTES_CACHE_KEY, JSON.stringify(notes));
}

const inFlight = new Set<string>();

/** Sends one cached note to the sheet and marks it saved; a note already on its way is left alone. */
export async function pushNote(url: string, id: string, fetchFn: FetchFn = fetch): Promise<Note[]> {
  const note = loadCachedNotes().find((n) => n.id === id);
  if (!note || note.saved || inFlight.has(id)) return loadCachedNotes();
  inFlight.add(id);
  try {
    const date = await addNote(url, note.text, fetchFn);
    const next = loadCachedNotes().map((n) => (n.id === id ? { ...n, date, saved: true } : n));
    saveCachedNotes(next);
    return next;
  } finally {
    inFlight.delete(id);
  }
}

/** Reads the sheet, then sends every note it does not have yet. Returns the sheet's own link. */
export async function syncNotes(url: string, onChange: (notes: Note[]) => void, fetchFn: FetchFn = fetch): Promise<string> {
  const sheet = await fetchNotes(url, fetchFn);
  const merged = mergeNotes(sheet.notes, loadCachedNotes());
  saveCachedNotes(merged);
  onChange(merged);
  for (const note of merged.filter((n) => !n.saved)) onChange(await pushNote(url, note.id, fetchFn));
  return sheet.sheetUrl;
}
