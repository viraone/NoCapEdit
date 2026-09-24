"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

/** Icon-over-label tile button used by the inspector panels. */
export function Tile({ icon, label, active, className, ...props }: { icon: ReactNode; label: string; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={cx("tile", className)} data-active={active ? "true" : "false"} {...props}>
      <span className="flex h-5 items-center justify-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function TileGrid({ children, cols = 4 }: { children: ReactNode; cols?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {children}
    </div>
  );
}
