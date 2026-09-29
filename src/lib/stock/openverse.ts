/**
 * Free music search through Openverse (openverse.org), the Creative Commons
 * catalogue that indexes Jamendo's ~640k tracks. No API key, CORS-open, and
 * Jamendo serves the MP3s with CORS headers, so a track can be downloaded
 * straight into the browser's storage. Every result is Creative Commons and
 * carries its licence; credit the artist when the licence asks for it.
 */

export interface MusicResult {
  id: string;
  title: string;
  artist: string;
  artistUrl: string | null;
  /** Page on the source site (Jamendo). */
  pageUrl: string;
  /** Direct MP3 URL. */
  url: string;
  /** Seconds. */
  duration: number;
  genres: string[];
  /** Licence slug, e.g. "by", "by-sa", "by-nc". */
  license: string;
  licenseUrl: string | null;
  /** True for BY and BY-SA (usable in commercial posts). */
  commercial: boolean;
  bytes: number | null;
}

/** Attribution stored with the project's music track. */
export interface MusicCredit {
  title: string;
  artist: string;
  license: string;
  licenseUrl: string | null;
  pageUrl: string;
  source: "openverse";
}

export interface MusicSearchOptions {
  /** Only BY / BY-SA licences (safe for commercial use). Default true. */
  commercialOnly?: boolean;
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

const API = "https://api.openverse.org/v1/audio/";

interface OpenverseAudio {
  id: string;
  title: string;
  creator: string | null;
  creator_url: string | null;
  foreign_landing_url: string;
  url: string;
  duration: number | null;
  genres: string[] | null;
  license: string;
  license_url: string | null;
  filesize: number | null;
}

export function licenseLabel(license: string): string {
  return `CC ${license.toUpperCase()}`;
}

/** One line of credit in the form Creative Commons recommends. */
export function creditLine(c: MusicCredit): string {
  return `"${c.title}" by ${c.artist} (${licenseLabel(c.license)}) · ${c.pageUrl}`;
}

export async function searchMusic(query: string, opts: MusicSearchOptions = {}): Promise<{ results: MusicResult[]; total: number }> {
  const q = query.trim();
  if (!q) return { results: [], total: 0 };
  const params = new URLSearchParams({
    q,
    category: "music",
    source: "jamendo",
    page_size: String(opts.pageSize ?? 20),
    page: String(opts.page ?? 1),
  });
  // Openverse's "commercial" type still includes BY-ND; syncing music to a video
  // is an adaptation, so only licences that allow derivatives are asked for.
  if (opts.commercialOnly !== false) params.set("license", "by,by-sa,cc0,pdm");
  const res = await fetch(`${API}?${params}`, { signal: opts.signal, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(res.status === 429 ? "Openverse is rate-limiting searches; try again in a minute." : `Music search failed (${res.status}).`);
  const data = (await res.json()) as { result_count: number; results: OpenverseAudio[] };
  const results = data.results
    .filter((r) => r.url)
    .map<MusicResult>((r) => ({
      id: r.id,
      title: r.title || "Untitled",
      artist: r.creator || "Unknown artist",
      artistUrl: r.creator_url,
      pageUrl: r.foreign_landing_url,
      url: r.url,
      duration: (r.duration ?? 0) / 1000,
      genres: r.genres ?? [],
      license: r.license,
      licenseUrl: r.license_url,
      commercial: r.license === "by" || r.license === "by-sa" || r.license === "cc0" || r.license === "pdm",
      bytes: r.filesize,
    }));
  return { results, total: data.result_count };
}

/** Downloads the MP3 into memory with progress (0..1 when the size is known). */
export async function downloadTrack(track: MusicResult, onProgress?: (fraction: number | null) => void, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(track.url, { signal });
  if (!res.ok || !res.body) throw new Error(`Could not download "${track.title}" (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || track.bytes || 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.(total ? Math.min(0.999, loaded / total) : null);
  }
  return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
}

export function creditFor(track: MusicResult): MusicCredit {
  return { title: track.title, artist: track.artist, license: track.license, licenseUrl: track.licenseUrl, pageUrl: track.pageUrl, source: "openverse" };
}
