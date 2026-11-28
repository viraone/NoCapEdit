/**
 * One opening shot, shared by every project, kept in its own database so it
 * outlives the project it was cut from and an app restart.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export interface Opener {
  /** The chosen file's name, so the panel can say what is saved. */
  name: string;
  /** The already trimmed short video. */
  blob: Blob;
  seconds: number;
}

interface RecapDB extends DBSchema {
  opener: { key: string; value: Opener };
}

const DB_NAME = "nocap-recap";
const STORE = "opener";
const KEY = "current";

let dbPromise: Promise<IDBPDatabase<RecapDB>> | null = null;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function recapDb(): Promise<IDBPDatabase<RecapDB>> {
  if (!dbPromise) {
    dbPromise = openDB<RecapDB>(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      },
    }).catch((e) => {
      dbPromise = null;
      throw e;
    });
  }
  return dbPromise;
}

/** Saves one opening shot, replacing any earlier one. */
export async function saveOpener(opener: Opener): Promise<void> {
  if (!hasIndexedDb()) throw new Error("This browser cannot keep an opening shot.");
  const db = await recapDb();
  await db.put(STORE, opener, KEY);
}

/** The saved opening shot, or null when none is saved or it can't be read back. */
export async function loadOpener(): Promise<Opener | null> {
  if (!hasIndexedDb()) return null;
  try {
    const db = await recapDb();
    const value = await db.get(STORE, KEY);
    if (!value || typeof value !== "object") return null;
    if (typeof value.name !== "string" || typeof value.seconds !== "number" || !(value.blob instanceof Blob)) return null;
    return value;
  } catch {
    return null;
  }
}

/** Forgets the opening shot. */
export async function clearOpener(): Promise<void> {
  try {
    const db = await recapDb();
    await db.delete(STORE, KEY);
  } catch {
    /* nothing stored, or no database to reach */
  }
}

/**
 * "4:06.6" is 4 minutes 6.6 seconds, "12" is 12 seconds and "1:02:03" is an
 * hour, 2 minutes and 3 seconds. Null for anything else, including a part
 * after the first that is 60 or more.
 */
export function parseClock(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!/^\d*\.?\d+$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    if (i > 0 && value >= 60) return null;
    total = total * 60 + value;
  }
  return total;
}
