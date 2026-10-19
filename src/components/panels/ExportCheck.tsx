"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { useEditor } from "@/store/editorStore";
import { getAsset } from "@/lib/storage/db";
import { browserPreflightEnv, runPreflight, type PreflightIssue, type PreflightOptions, type PreflightTarget } from "@/lib/export/preflight";
import type { VideoProject } from "@/lib/models/project";
import { PanelSection } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

export interface PreflightState {
  issues: PreflightIssue[] | null;
  checking: boolean;
  run: () => void;
}

/**
 * Runs the pre-export check for the project on screen: when the panel opens and
 * (after a short pause) every time the project or the layers chosen change.
 * `issues` is null until the first check has finished.
 */
export function usePreflight(project: VideoProject, opts: PreflightOptions): PreflightState {
  const [issues, setIssues] = useState<PreflightIssue[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [tick, setTick] = useState(0);
  const generation = useRef(0);
  const { captionSource, includeCaptions, includeOverlays } = opts;

  useEffect(() => {
    const mine = ++generation.current;
    const timer = setTimeout(async () => {
      setChecking(true);
      try {
        const found = await runPreflight(project, browserPreflightEnv(getAsset), { captionSource, includeCaptions, includeOverlays });
        if (mine === generation.current) setIssues(found);
      } catch (e) {
        if (mine === generation.current) setIssues([{ id: "check-failed", severity: "warning", title: "The check could not finish", detail: e instanceof Error ? e.message : String(e) }]);
      } finally {
        if (mine === generation.current) setChecking(false);
      }
    }, 450);
    return () => clearTimeout(timer);
  }, [project, captionSource, includeCaptions, includeOverlays, tick]);

  const run = useCallback(() => setTick((n) => n + 1), []);
  return { issues, checking, run };
}

/** Takes the editor to what an issue is about: its panel, the element, the moment. */
export function showIssue(target: PreflightTarget | undefined) {
  if (!target) return;
  const s = useEditor.getState();
  s.setTool(target.tool);
  s.select(target.select ?? null);
  if (target.time !== undefined) s.seek(target.time);
}

export function ExportCheck({ state }: { state: PreflightState }) {
  const { issues, checking, run } = state;
  const errors = issues?.filter((i) => i.severity === "error").length ?? 0;
  const warnings = issues?.filter((i) => i.severity === "warning").length ?? 0;
  const summary = issues === null ? "Checking…" : errors ? `${errors} problem${errors === 1 ? "" : "s"} to fix` : warnings ? `${warnings} thing${warnings === 1 ? "" : "s"} to look at` : "Ready to export";

  return (
    <PanelSection
      title="Check before export"
      right={
        <Button variant="ghost" size="xs" onClick={run} disabled={checking} aria-label="Check again" title="Check again">
          {checking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Check again
        </Button>
      }
    >
      <div data-export-check data-check-state={issues === null ? "pending" : errors ? "error" : warnings ? "warning" : "ok"}>
        <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${errors ? "text-sys-red" : warnings ? "text-sys-orange" : issues === null ? "text-label-2" : "text-sys-green"}`} aria-live="polite">
          {issues === null ? <Loader2 size={15} className="animate-spin" /> : errors ? <XCircle size={15} /> : warnings ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
          {summary}
        </p>
        {issues === null || issues.length === 0 ? (
          issues !== null && <p className="rf-read-note mt-1">Media is readable, fonts loaded, and no text runs past the edge of the picture.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {issues.map((i) => (
              <li key={i.id} className={`rounded-lg border p-2.5 ${i.severity === "error" ? "border-sys-red/40 bg-sys-red/10" : "border-sys-orange/40 bg-sys-orange/10"}`} data-issue={i.id} data-severity={i.severity}>
                <p className="flex items-start gap-1.5 text-[12.5px] font-semibold">
                  {i.severity === "error" ? <XCircle size={14} className="mt-px shrink-0 text-sys-red" /> : <AlertTriangle size={14} className="mt-px shrink-0 text-sys-orange" />}
                  <span>{i.title}</span>
                </p>
                <p className="rf-read-note mt-1 [overflow-wrap:anywhere]">{i.detail}</p>
                {i.target && (
                  <Button variant="secondary" size="xs" className="mt-1.5" onClick={() => showIssue(i.target)}>
                    Show me
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </PanelSection>
  );
}
