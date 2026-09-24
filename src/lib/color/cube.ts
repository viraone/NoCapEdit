/** Adobe/Resolve .cube 3D LUT parser with an asset-backed cache for the preview. */
import { getAsset } from "@/lib/storage/db";

export interface Lut3D {
  size: number;
  /** RGB triplets, r fastest, 0..255. */
  data: Uint8Array;
  title: string;
}

export function parseCube(text: string): Lut3D {
  let size = 0;
  let title = "";
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("TITLE")) title = line.slice(5).trim().replace(/^"|"$/g, "");
    else if (line.startsWith("LUT_3D_SIZE")) size = Number(line.split(/\s+/)[1]);
    else if (line.startsWith("DOMAIN_MIN")) min = line.split(/\s+/).slice(1, 4).map(Number);
    else if (line.startsWith("DOMAIN_MAX")) max = line.split(/\s+/).slice(1, 4).map(Number);
    else if (line.startsWith("LUT_1D_SIZE")) throw new Error("1D LUTs are not supported; use a 3D .cube");
    else if (/^[-\d.eE]/.test(line)) {
      const [r, g, b] = line.split(/\s+/).map(Number);
      values.push(r, g, b);
    }
  }
  if (!size || values.length < size * size * size * 3) throw new Error("Invalid .cube file");
  const data = new Uint8Array(size * size * size * 3);
  for (let i = 0; i < data.length; i++) {
    const c = i % 3;
    const v = (values[i] - min[c]) / (max[c] - min[c] || 1);
    data[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return { size, data, title };
}

const cache = new Map<string, Lut3D | null>();
const loading = new Set<string>();

/** Returns the parsed LUT if loaded, otherwise kicks off loading and returns null. */
export function getLutSync(assetId: string): Lut3D | null {
  if (cache.has(assetId)) return cache.get(assetId) ?? null;
  if (!loading.has(assetId)) {
    loading.add(assetId);
    getAsset(assetId)
      .then(async (a) => cache.set(assetId, a ? parseCube(await a.blob.text()) : null))
      .catch(() => cache.set(assetId, null))
      .finally(() => loading.delete(assetId));
  }
  return null;
}

export async function getLut(assetId: string): Promise<Lut3D | null> {
  if (cache.has(assetId)) return cache.get(assetId) ?? null;
  const a = await getAsset(assetId);
  const lut = a ? parseCube(await a.blob.text()) : null;
  cache.set(assetId, lut);
  return lut;
}
