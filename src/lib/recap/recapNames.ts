export interface SavedRecap {
  names: Record<number, string>;
  closing: string | null;
}

export function loadRecap(projectId: string): SavedRecap {
  try {
    const raw = localStorage.getItem(`reelflow.recap.${projectId}`);
    if (!raw) return { names: {}, closing: null };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { names: {}, closing: null };
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
    return { names, closing };
  } catch {
    return { names: {}, closing: null };
  }
}

export function saveRecap(projectId: string, value: { names: Record<number, string>; closing: string }): void {
  try {
    localStorage.setItem(`reelflow.recap.${projectId}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}
