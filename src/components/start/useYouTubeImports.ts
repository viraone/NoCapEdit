"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createProject } from "@/lib/models/project";
import { saveProject, requestPersistentStorage } from "@/lib/storage/db";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { defaultTitle, formatFor, parseMediaLink, SITE_NAME, type MediaSource, type YouTubeChoice, type YouTubeFormat } from "@/lib/youtube/url";
import { downloadYouTube, fetchYouTubeInfo, YouTubeServiceError } from "@/lib/youtube/service";
import { downloadBlob } from "@/lib/utils/download";
import { uid } from "@/lib/utils/id";

export type YouTubeStage = "info" | "fetching" | "saving" | "importing" | "error";

/** One pasted link on its way to becoming a project (MP4) or a file on the visitor's computer (MP3); shown as a card under Your projects. */
export interface YouTubeImport {
  key: string;
  link: string;
  source: MediaSource;
  /** YouTube video id or Instagram shortcode. */
  videoId: string;
  format: YouTubeFormat;
  quality: number;
  title: string;
  thumbnail: string | null;
  stage: YouTubeStage;
  /** Bytes received so far and the whole file, once the helper starts sending it. */
  loaded: number;
  total: number | null;
  error: string | null;
}

export function youtubeStageText(item: YouTubeImport): string {
  switch (item.stage) {
    case "info":
      return "Looking up the video… the helper can take a minute to wake up";
    case "fetching":
      return item.format === "mp3" ? `Fetching from ${SITE_NAME[item.source]} and converting to MP3… this can take a minute for long videos` : `Fetching from ${SITE_NAME[item.source]}… this can take a minute for long videos`;
    case "saving":
      return item.total ? `Receiving ${Math.round((item.loaded / item.total) * 100)}%` : "Receiving…";
    case "importing":
      return item.format === "mp3" ? "Saving the MP3 to your computer…" : "Adding to your projects…";
    case "error":
      return item.error ?? "Something went wrong";
  }
}

/**
 * Runs YouTube and Instagram imports: look the link up, fetch the MP4 through the
 * helper, store it on this device as a new project. The project is only written once
 * the file has fully arrived, so a failed or cancelled fetch leaves nothing behind.
 * An MP3 can't be edited here, so it skips the project and goes straight to the
 * visitor's Downloads folder as a normal browser download.
 */
export function useYouTubeImports(onImported: (projectId: string) => void) {
  const [items, setItems] = useState<YouTubeImport[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  const importedRef = useRef(onImported);
  useEffect(() => {
    importedRef.current = onImported;
  }, [onImported]);

  const patch = useCallback((key: string, changes: Partial<YouTubeImport>) => {
    setItems((list) => list.map((it) => (it.key === key ? { ...it, ...changes } : it)));
  }, []);

  const drop = useCallback((key: string) => {
    controllers.current.delete(key);
    setItems((list) => list.filter((it) => it.key !== key));
  }, []);

  const run = useCallback(
    async (item: YouTubeImport) => {
      const abort = new AbortController();
      controllers.current.set(item.key, abort);
      const { key, source, videoId, format, quality } = item;
      const media = { source, id: videoId };
      try {
        const info = await fetchYouTubeInfo(media, abort.signal);
        patch(key, { title: info.title, thumbnail: info.thumbnail, stage: "fetching" });
        if (info.maxSeconds && info.duration > info.maxSeconds) {
          throw new YouTubeServiceError(`This video is ${Math.round(info.duration / 60)} minutes long; the helper takes up to ${Math.round(info.maxSeconds / 60)}.`, "rejected");
        }
        const { file, title } = await downloadYouTube(media, { format, height: quality }, (loaded, total) => patch(key, { stage: "saving", loaded, total }), abort.signal);
        patch(key, { stage: "importing", title });
        if (format === "mp3") {
          downloadBlob(file, file.name);
          drop(key);
          return;
        }
        const project = createProject({ name: title });
        await saveProject(project);
        try {
          const { clip, blob } = await importVideo(file, project.id);
          project.clips.push(clip);
          await updateProjectThumbnail(project.id, blob, Math.min(1, clip.duration / 2));
          await saveProject(project);
        } catch (e) {
          // Never leave an empty project behind on the start screen.
          const { deleteProject } = await import("@/lib/storage/db");
          await deleteProject(project.id).catch(() => undefined);
          throw e;
        }
        await requestPersistentStorage();
        drop(key);
        importedRef.current(project.id);
      } catch (e) {
        if (abort.signal.aborted || (e instanceof YouTubeServiceError && e.kind === "cancelled")) {
          drop(key);
          return;
        }
        controllers.current.delete(key);
        patch(key, { stage: "error", error: e instanceof Error ? e.message : String(e) });
      }
    },
    [patch, drop],
  );

  /** Starts an import. Throws when the text is not a YouTube or Instagram link, so the bar can say so inline. */
  const start = useCallback(
    (link: string, { format, quality }: YouTubeChoice) => {
      const media = parseMediaLink(link);
      if (!media) {
        throw new Error("That doesn't look like a YouTube or Instagram link. Paste the address of a video or reel, e.g. https://youtu.be/… or https://www.instagram.com/reel/…");
      }
      const item: YouTubeImport = {
        key: uid("yt"),
        link: link.trim(),
        source: media.source,
        videoId: media.id,
        format: formatFor(media.source, format),
        quality,
        title: defaultTitle(media.source),
        thumbnail: null,
        stage: "info",
        loaded: 0,
        total: null,
        error: null,
      };
      setItems((list) => [item, ...list]);
      void run(item);
    },
    [run],
  );

  const cancel = useCallback(
    (key: string) => {
      controllers.current.get(key)?.abort();
      drop(key);
    },
    [drop],
  );

  const retry = useCallback(
    (key: string) => {
      setItems((list) => {
        const old = list.find((it) => it.key === key);
        if (!old) return list;
        const fresh: YouTubeImport = { ...old, stage: "info", error: null, loaded: 0, total: null };
        void run(fresh);
        return list.map((it) => (it.key === key ? fresh : it));
      });
    },
    [run],
  );

  // Abort anything still in flight when the start screen unmounts.
  useEffect(() => {
    const map = controllers.current;
    return () => {
      for (const c of map.values()) c.abort();
      map.clear();
    };
  }, []);

  return { items, start, cancel, retry, dismiss: drop };
}
