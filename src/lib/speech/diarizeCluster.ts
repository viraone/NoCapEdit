/**
 * Speaker clustering helpers for diarization (pure, unit-tested): cosine
 * distance, average-linkage agglomerative clustering and a clean-up pass that
 * folds tiny clusters into the nearest real speaker.
 */

export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

/** Renumbers labels by first appearance (0, 1, 2 …). */
export function relabelByAppearance(labels: number[]): number[] {
  const map = new Map<number, number>();
  return labels.map((l) => {
    if (!map.has(l)) map.set(l, map.size);
    return map.get(l)!;
  });
}

/** Average-linkage agglomerative clustering on cosine distance. */
export function cluster(embeddings: Float32Array[], threshold: number, maxClusters: number): number[] {
  const n = embeddings.length;
  let clusters: number[][] = embeddings.map((_, i) => [i]);
  const dist = (a: number[], b: number[]) => {
    let s = 0;
    for (const i of a) for (const j of b) s += cosineDistance(embeddings[i], embeddings[j]);
    return s / (a.length * b.length);
  };
  while (clusters.length > 1) {
    let best = { d: Infinity, a: -1, b: -1 };
    for (let a = 0; a < clusters.length; a++)
      for (let b = a + 1; b < clusters.length; b++) {
        const d = dist(clusters[a], clusters[b]);
        if (d < best.d) best = { d, a, b };
      }
    if (best.d > threshold && clusters.length <= maxClusters) break;
    const merged = [...clusters[best.a], ...clusters[best.b]];
    clusters = clusters.filter((_, i) => i !== best.a && i !== best.b);
    clusters.push(merged);
  }
  // Order speakers by first appearance.
  clusters.sort((a, b) => Math.min(...a) - Math.min(...b));
  const labels = new Array<number>(n).fill(0);
  clusters.forEach((c, label) => c.forEach((i) => (labels[i] = label)));
  return labels;
}

/**
 * Folds clusters that own less than `minSeconds` of speech into the nearest
 * substantial cluster (by cosine distance to its centroid). A speaker who
 * only ever "owns" one short turn is almost always a clustering artefact of
 * a real speaker's odd-sounding turn, not a third person.
 */
export function mergeSmallClusters(labels: number[], embeddings: Float32Array[], durations: number[], minSeconds = 1): number[] {
  const total = new Map<number, number>();
  labels.forEach((l, i) => total.set(l, (total.get(l) ?? 0) + durations[i]));
  const keep = [...total.entries()].filter(([, d]) => d >= minSeconds).map(([l]) => l);
  if (keep.length === 0 || keep.length === total.size) return relabelByAppearance(labels);
  const centroids = new Map<number, Float32Array>();
  for (const label of keep) {
    const members = labels.map((l, i) => (l === label ? i : -1)).filter((i) => i >= 0);
    const c = new Float32Array(embeddings[members[0]].length);
    for (const i of members) for (let k = 0; k < c.length; k++) c[k] += embeddings[i][k] / members.length;
    centroids.set(label, c);
  }
  const out = labels.map((l, i) => {
    if (centroids.has(l)) return l;
    let best = keep[0];
    let bestDistance = Infinity;
    for (const [label, c] of centroids) {
      const d = cosineDistance(embeddings[i], c);
      if (d < bestDistance) {
        bestDistance = d;
        best = label;
      }
    }
    return best;
  });
  return relabelByAppearance(out);
}

/**
 * Drops pyannote's NO_SPEAKER (silence) turns before speaker embedding. The
 * segmentation model's classes are {0: NO_SPEAKER, 1-3: SPEAKER_n, 4-6:
 * overlaps}; silence embeddings are near-identical, so left in they form a
 * phantom speaker that crowds out or merges the real voices.
 */
export function speechTurns<T extends { localId: number }>(turns: T[], id2label?: Record<string, string>): T[] {
  return turns.filter((t) => (id2label ? id2label[String(t.localId)] !== "NO_SPEAKER" : t.localId !== 0));
}
