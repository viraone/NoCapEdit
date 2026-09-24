import { describe, expect, it } from "vitest";
import { cluster, cosineDistance, mergeSmallClusters, relabelByAppearance } from "@/lib/speech/diarizeCluster";

const v = (...x: number[]) => new Float32Array(x);

describe("diarization clustering", () => {
  it("measures cosine distance", () => {
    expect(cosineDistance(v(1, 0), v(1, 0))).toBeCloseTo(0, 6);
    expect(cosineDistance(v(1, 0), v(0, 1))).toBeCloseTo(1, 6);
  });

  it("groups similar embeddings and orders speakers by first appearance", () => {
    const labels = cluster([v(1, 0), v(0, 1), v(0.98, 0.1), v(0.1, 0.98)], 0.5, 4);
    expect(labels).toEqual([0, 1, 0, 1]);
  });

  it("folds a speaker who owns a single short turn into the nearest real speaker", () => {
    // Two real voices (A around (1,0), B around (0,1)) and one odd A turn that was split off.
    const embeddings = [v(1, 0), v(0, 1), v(0.9, 0.1), v(0.1, 0.9), v(0.7, 0.3), v(0, 1)];
    const labels = [0, 1, 0, 1, 2, 1];
    const durations = [3, 2.5, 2, 4, 0.6, 3];
    expect(mergeSmallClusters(labels, embeddings, durations, 1)).toEqual([0, 1, 0, 1, 0, 1]);
  });

  it("keeps clusters that own enough speech", () => {
    const embeddings = [v(1, 0), v(0, 1), v(0.5, 0.5)];
    expect(mergeSmallClusters([0, 1, 2], embeddings, [3, 3, 3], 1)).toEqual([0, 1, 2]);
  });

  it("renumbers by first appearance", () => {
    expect(relabelByAppearance([2, 2, 0, 5, 0])).toEqual([0, 0, 1, 2, 1]);
  });
});
