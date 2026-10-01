import type { ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

export function PanelHeader({ title, description, body, meta, actions }: { title: string; description?: string; /** Formatted reading text in place of the one-line description. */ body?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 border-b border-sys-gray5 bg-sys-gray6/95 px-4 pb-3 pt-3.5 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <h2 className="caps shrink-0">{title}</h2>
        {/* Meta (a clip name, a count) shortens with an ellipsis rather than wrapping. */}
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-label-2">
          {meta}
          {actions}
        </div>
      </div>
      {description && <p className="rf-read mt-2">{description}</p>}
      {body && <div className="mt-2.5">{body}</div>}
    </div>
  );
}

export function PanelSection({ title, children, className, right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cx("space-y-2.5 px-4 py-3", className)}>
      {(title || right) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="caps">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-sys-gray4 px-4 py-8 text-center">
      {icon && <div className="text-sys-gray2">{icon}</div>}
      <p className="text-[13px] font-semibold text-white">{title}</p>
      {description && <p className="rf-read-note max-w-60">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
