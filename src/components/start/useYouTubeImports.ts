"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createProject } from "@/lib/models/project";
import { saveProject, requestPersistentStorage } from "@/lib/storage/db";
import { importVideo, updateProjectThumbnail } from "@/lib/media/import";
import { youtubeVideoId } from "@/lib/youtube/url";
import { downloadYouTube, fetchYouTubeInfo, YouTubeServiceError } from "@/lib/youtube/service";
import { uid } from "@/lib/utils/id";

export type YouTubeStage = "info" | "fetching" | "saving" | "importing" | "error";

/** One pasted link on its way to becoming a project; shown as a card under Your projects. */
export interface YouTubeImport {
  key: string;
  link: string;
  videoId: string;
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
      return "Looking up the video…";
    case "fetching":
      return "Fetching from YouTube… this can take a minute for long videos";
    case "saving":
      return item.total ? `Receiving ${Math.round((item.loaded / item.total) * 100)}%` : "Receiving…";
    case "importing":
      return "Adding to your projects…";
    case "error":
      return item.error ?? "Something went wrong";
  }
}

/**
 * Runs YouTube imports: look the link up, fetch the MP4 through the helper,
 * store it on this device as a new project. The project is only written once
 * the file has fully arrived, so a failed or cancelled fetch leaves nothing behind.
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
      const { key, videoId, quality } = item;
      try {
        const info = await fetchYouTubeInfo(videoId, abort.signal);
        patch(key, { title: info.title, thumbnail: info.thumbnail, stage: "fetching" });
        if (info.maxSeconds && info.duration > info.maxSeconds) {
          throw new YouTubeServiceError(`This video is ${Math.round(info.duration / 60)} minutes long; the helper takes up to ${Math.round(info.maxSeconds / 60)}.`, "rejected");
        }
        const { file, title } = await downloadYouTube(videoId, quality, (loaded, total) => patch(key, { stage: "saving", loaded, total }), abort.signal);
        patch(key, { stage: "importing", title });
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

  /** Starts an import. Throws when the text is not a YouTube link, so the bar can say so inline. */
  const start = useCallback(
    (link: string, quality: number) => {
      const videoId = youtubeVideoId(link);
      if (!videoId) throw new Error("That doesn't look like a YouTube link. Paste the address of a video, e.g. https://youtu.be/…");
      const item: YouTubeImport = {
        key: uid("yt"),
        link: link.trim(),
        videoId,
        quality,
        title: "YouTube video",
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
