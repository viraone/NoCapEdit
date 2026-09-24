import { cx } from "@/lib/utils/cx";

export function ProgressBar({ value, indeterminate, className }: { value: number | null; indeterminate?: boolean; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round((value ?? 0) * 100)));
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-sys-gray4", className)} role="progressbar" aria-valuenow={pct}>
      {indeterminate || value === null ? (
        <div className="rf-indeterminate h-full w-1/3 rounded-full bg-sys-blue" />
      ) : (
        <div className="h-full rounded-full bg-sys-blue transition-[width] duration-200" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}
