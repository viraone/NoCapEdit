"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { chooseSaveFolder, forgetSaveFolder, loadSaveFolder, supportsSaveFolder } from "@/lib/utils/saveFolder";

export interface SaveFolderControl {
  /** False in browsers without the folder picker (Safari, Firefox, phones): the control stays hidden. */
  supported: boolean;
  /** The remembered folder's name, or null when downloads go to the browser's own Downloads handling. */
  name: string | null;
  error: string | null;
  choose: () => Promise<void>;
  forget: () => Promise<void>;
}

/** The start page's "save to a folder" choice: the remembered folder, picking a new one, and going back to plain Downloads. */
export function useSaveFolder(): SaveFolderControl {
  // False on the server and for the first client render, so the page hydrates cleanly.
  const supported = useSyncExternalStore(
    () => () => undefined,
    supportsSaveFolder,
    () => false,
  );
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void loadSaveFolder().then((folder) => {
      if (live) setName(folder?.name ?? null);
    });
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback(async () => {
    setError(null);
    try {
      const folder = await chooseSaveFolder();
      if (folder) setName(folder.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const forget = useCallback(async () => {
    setError(null);
    await forgetSaveFolder();
    setName(null);
  }, []);

  return { supported, name, error, choose, forget };
}
