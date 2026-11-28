export interface SavedRecap {
  names: Record<number, string>;
  closing: string | null;
  /** Names for the moments, keyed by the second each laugh starts at. */
  titles: Record<string, string>;
}

export function loadRecap(projectId: string): SavedRecap {
  try {
    const raw = localStorage.getItem(`reelflow.recap.${projectId}`);
    if (!raw) return { names: {}, closing: null, titles: {} };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { names: {}, closing: null, titles: {} };
    const names: Record<number, string> = {};
    const rawNames = parsed.names;
    if (rawNames && typeof rawNames === "object") {
      for (const key of Object.keys(rawNames)) {
        const numKey = Number(key);
        if (Number.isFinite(numKey)) {
          const val = rawNames[key];
          if (typeof val === "string") {
            names[numKey] = val;
          }
        }
      }
    }
    const closing = typeof parsed.closing === "string" ? parsed.closing : null;
    const titles: Record<string, string> = {};
    if (parsed.titles && typeof parsed.titles === "object") {
      for (const [key, val] of Object.entries(parsed.titles)) {
        if (typeof val === "string") titles[key] = val;
      }
    }
    return { names, closing, titles };
  } catch {
    return { names: {}, closing: null, titles: {} };
  }
}

export function saveRecap(projectId: string, value: { names: Record<number, string>; closing: string }): void {
  write(projectId, { ...value, titles: loadRecap(projectId).titles });
}

/** Adds moment names to the ones already kept, leaving the rest as it was. */
export function saveTitles(projectId: string, titles: Record<string, string>): void {
  const saved = loadRecap(projectId);
  write(projectId, { names: saved.names, closing: saved.closing, titles: { ...saved.titles, ...titles } });
}

function write(projectId: string, value: { names: Record<number, string>; closing: string | null; titles: Record<string, string> }): void {
  try {
    localStorage.setItem(`reelflow.recap.${projectId}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
