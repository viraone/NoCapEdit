import { cx } from "@/lib/utils/cx";

/**
 * Progress bar. A known amount glides to each new value (ease-out over ~0.9 s,
 * so stepwise updates such as Whisper's per-chunk progress read as motion) with
 * a soft sheen while it is under way; an unknown amount shows a gradient sweep.
 */
export function ProgressBar({ value, indeterminate, className }: { value: number | null; indeterminate?: boolean; className?: string }) {
  const pct = Math.max(0, Math.min(100, (value ?? 0) * 100));
  const busy = indeterminate || value === null;
  return (
    <div className={cx("relative h-1.5 w-full overflow-hidden rounded-full bg-sys-gray4", className)} role="progressbar" aria-valuenow={busy ? undefined : Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-busy={busy || undefined}>
      {busy ? (
        <div className="rf-indeterminate absolute inset-0 rounded-full" />
      ) : (
        <div className="rf-progress-fill relative h-full overflow-hidden rounded-full" style={{ width: `${pct}%`, minWidth: pct > 0 ? 6 : 0 }} />
      )}
    </div>
  );
}
