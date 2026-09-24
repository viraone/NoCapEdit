import type { ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

export function PanelHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
      <div>
        <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] leading-snug text-neutral-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}

export function PanelSection({ title, children, className, right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cx("space-y-3 border-b border-neutral-800/80 px-4 py-3", className)}>
      {(title || right) && (
        <div className="flex items-center justify-between">
          {title && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">{title}</h3>}
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-neutral-800 px-4 py-8 text-center">
      {icon && <div className="text-neutral-600">{icon}</div>}
      <p className="text-sm font-medium text-neutral-300">{title}</p>
      {description && <p className="max-w-56 text-[11px] leading-snug text-neutral-500">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
