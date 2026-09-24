"use client";
import type { SelectHTMLAttributes } from "react";
import { cx } from "@/lib/utils/cx";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "h-8 w-full rounded-md border border-neutral-700/70 bg-neutral-900 px-2 text-sm text-neutral-100 focus:border-brand-500/70 focus:outline-none focus:ring-1 focus:ring-brand-500/40 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
