"use client";
import { useEffect, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { exportFolderBridge, useExportFolder } from "@/lib/utils/exportFolder";

const noSubscription = () => () => undefined;
const folderBridge = () => !!exportFolderBridge();
const no = () => false;

/**
 * The desktop app's "save straight into a folder" row: which folder, changing it, or going back to
 * a save window each time. The website has no bridge, so the row renders nothing there.
 */
export function ExportFolderRow({ disabled = false }: { disabled?: boolean }) {
  // False on the server and the first client render, so the page hydrates cleanly.
  const available = useSyncExternalStore(noSubscription, folderBridge, no);
  const folder = useExportFolder((s) => s.folder);
  const load = useExportFolder((s) => s.load);
  const choose = useExportFolder((s) => s.choose);
  const clear = useExportFolder((s) => s.clear);

  useEffect(() => {
    void load();
  }, [load]);

  if (!available) return null;

  return (
    <div className="space-y-1.5" data-export-folder>
      {folder ? (
        <>
          <p className="rf-read-note" title={folder.path}>
            Saves to: <b>{folder.name}</b>
          </p>
          {!folder.ok && <p className="rf-read-note rf-error">That folder was not found. Choose another.</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button variant="secondary" size="xs" onClick={() => void choose()} disabled={disabled} data-export-folder-choose>
              Change…
            </Button>
            <Button variant="ghost" size="xs" onClick={() => void clear()} disabled={disabled} data-export-folder-clear>
              Ask each time
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="rf-read-note">Saves where you pick each time.</p>
          <Button variant="secondary" size="xs" onClick={() => void choose()} disabled={disabled} data-export-folder-choose>
            Choose a save folder…
          </Button>
        </>
      )}
    </div>
  );
}
