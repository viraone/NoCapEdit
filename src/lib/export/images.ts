import { getAsset } from "@/lib/storage/db";

/** Decodes the stored sticker images the frame renderers draw, keyed by asset id (an image that fails to load is left out). */
export async function loadImages(assetIds: string[]): Promise<Map<string, HTMLImageElement>> {
  const map = new Map<string, HTMLImageElement>();
  await Promise.all(
    assetIds.map(async (id) => {
      const asset = await getAsset(id);
      if (!asset) return;
      const url = URL.createObjectURL(asset.blob);
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          map.set(id, img);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
    }),
  );
  return map;
}
