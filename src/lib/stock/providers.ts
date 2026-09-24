/**
 * Royalty-free stock footage via public web APIs, called straight from the
 * browser with the creator's own free API key (stored in localStorage only).
 * There is no proxy: requests go from the user's browser to the provider.
 */
export type StockProvider = "pexels" | "pixabay";

export interface StockVideo {
  id: string;
  provider: StockProvider;
  title: string;
  thumbnail: string;
  duration: number;
  width: number;
  height: number;
  /** Direct download URL of the chosen rendition. */
  url: string;
  author: string;
  pageUrl: string;
}

const KEY_STORAGE: Record<StockProvider, string> = { pexels: "reelflow.pexelsKey", pixabay: "reelflow.pixabayKey" };

export function getStockKey(provider: StockProvider): string {
  try {
    return localStorage.getItem(KEY_STORAGE[provider]) ?? "";
  } catch {
    return "";
  }
}

export function setStockKey(provider: StockProvider, key: string) {
  try {
    if (key) localStorage.setItem(KEY_STORAGE[provider], key);
    else localStorage.removeItem(KEY_STORAGE[provider]);
  } catch {
    /* storage blocked */
  }
}

interface PexelsFile {
  link: string;
  width: number;
  height: number;
  quality: string;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  url: string;
  image: string;
  duration: number;
  width: number;
  height: number;
  user: { name: string };
  video_files: PexelsFile[];
}

/** Picks the largest MP4 rendition whose short side is at most 1080 px. */
function pickPexelsFile(files: PexelsFile[]): PexelsFile | undefined {
  const mp4 = files.filter((f) => f.file_type === "video/mp4" && f.width && f.height);
  const ok = mp4.filter((f) => Math.min(f.width, f.height) <= 1080).sort((a, b) => b.width * b.height - a.width * a.height);
  return ok[0] ?? mp4.sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

export async function searchPexels(key: string, query: string, orientation: "portrait" | "landscape" | "square" | "" = ""): Promise<StockVideo[]> {
  const params = new URLSearchParams({ query, per_page: "18" });
  if (orientation) params.set("orientation", orientation);
  const res = await fetch(`https://api.pexels.com/videos/search?${params}`, { headers: { Authorization: key } });
  if (res.status === 401) throw new Error("Pexels rejected the API key.");
  if (!res.ok) throw new Error(`Pexels request failed (${res.status}).`);
  const json = (await res.json()) as { videos: PexelsVideo[] };
  return json.videos
    .map((v): StockVideo | null => {
      const file = pickPexelsFile(v.video_files);
      if (!file) return null;
      return {
        id: `pexels-${v.id}`,
        provider: "pexels" as const,
        title: `Pexels video ${v.id}`,
        thumbnail: v.image,
        duration: v.duration,
        width: file.width,
        height: file.height,
        url: file.link,
        author: v.user?.name ?? "",
        pageUrl: v.url,
      };
    })
    .filter((v): v is StockVideo => !!v);
}

interface PixabayVideo {
  id: number;
  pageURL: string;
  duration: number;
  tags: string;
  user: string;
  videos: Record<string, { url: string; width: number; height: number; thumbnail?: string }>;
}

export async function searchPixabay(key: string, query: string, orientation: "portrait" | "landscape" | "square" | "" = ""): Promise<StockVideo[]> {
  const params = new URLSearchParams({ key, q: query, per_page: "18", safesearch: "true" });
  const res = await fetch(`https://pixabay.com/api/videos/?${params}`);
  if (res.status === 400 || res.status === 401) throw new Error("Pixabay rejected the API key.");
  if (!res.ok) throw new Error(`Pixabay request failed (${res.status}).`);
  const json = (await res.json()) as { hits: PixabayVideo[] };
  return json.hits
    .map((v): StockVideo | null => {
      const rendition = v.videos.medium ?? v.videos.small ?? v.videos.large ?? Object.values(v.videos)[0];
      if (!rendition) return null;
      const ratio = rendition.width / rendition.height;
      if (orientation === "portrait" && ratio >= 1) return null;
      if (orientation === "landscape" && ratio <= 1) return null;
      if (orientation === "square" && Math.abs(ratio - 1) > 0.05) return null;
      return {
        id: `pixabay-${v.id}`,
        provider: "pixabay" as const,
        title: v.tags || `Pixabay video ${v.id}`,
        thumbnail: rendition.thumbnail ?? `https://i.vimeocdn.com/video/${v.id}_295x166.jpg`,
        duration: v.duration,
        width: rendition.width,
        height: rendition.height,
        url: rendition.url,
        author: v.user,
        pageUrl: v.pageURL,
      };
    })
    .filter((v): v is StockVideo => !!v);
}

export async function searchStock(provider: StockProvider, query: string, orientation: "portrait" | "landscape" | "square" | ""): Promise<StockVideo[]> {
  const key = getStockKey(provider);
  if (!key) throw new Error(`Add your free ${provider === "pexels" ? "Pexels" : "Pixabay"} API key first.`);
  return provider === "pexels" ? searchPexels(key, query, orientation) : searchPixabay(key, query, orientation);
}

/** Downloads the rendition as a File so it can go through the normal import path. */
export async function downloadStock(item: StockVideo, onProgress?: (loaded: number, total: number | null) => void): Promise<File> {
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(`Download failed (${res.status}). The provider may block cross-origin downloads for this file.`);
  const total = Number(res.headers.get("content-length")) || null;
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  const reader = res.body?.getReader();
  if (reader) {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      onProgress?.(loaded, total);
    }
  } else chunks.push(new Uint8Array(await res.arrayBuffer()));
  const name = `${item.provider}-${item.id.replace(/^[a-z]+-/, "")}.mp4`;
  return new File(chunks as BlobPart[], name, { type: "video/mp4" });
}
