"use client";
import type { SelectHTMLAttributes } from "react";
import { cx } from "@/lib/utils/cx";

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cx(
        "h-8 w-full rounded-lg border border-sys-gray4 bg-sys-gray5 px-2 text-[13px] text-white focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
