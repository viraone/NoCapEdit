/** Tiny pub/sub so timeline widgets refresh when a cache finishes building. */
type Listener = (assetId: string) => void;
const listeners: Record<"thumbs" | "peaks", Set<Listener>> = { thumbs: new Set(), peaks: new Set() };

export function onAssetReady(kind: "thumbs" | "peaks", fn: Listener): () => void {
  listeners[kind].add(fn);
  return () => listeners[kind].delete(fn);
}

export function emitAssetReady(kind: "thumbs" | "peaks", assetId: string) {
  for (const fn of listeners[kind]) fn(assetId);
}
