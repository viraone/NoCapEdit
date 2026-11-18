/**
 * Asks the download helper for a YouTube video's captions (its /transcript route runs
 * yt-dlp with --skip-download, so no video is fetched). Everything after that, the
 * text, the .srt and the documentary, is made on the visitor's device.
 */
import { normalizeCues, type Transcript } from "@/lib/documentary/transcript";
import { serviceFetch, YouTubeServiceError } from "./service";
import { mediaUrl, type MediaLink } from "./url";

export async function fetchTranscript(link: MediaLink, lang = "en", signal?: AbortSignal): Promise<Transcript> {
  const res = await serviceFetch(`/transcript?url=${encodeURIComponent(mediaUrl(link))}&lang=${encodeURIComponent(lang)}`, signal);
  const body = (await res.json()) as { title?: string; language?: string; cues?: unknown };
  const cues = normalizeCues(body.cues);
  if (!cues.length) throw new YouTubeServiceError("This video has no captions in that language.", "rejected");
  return { id: link.id, title: body.title || "Transcript", language: body.language || lang, cues };
}
