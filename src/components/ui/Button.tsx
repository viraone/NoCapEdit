"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/utils/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "icon" | "iconSm";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-400 disabled:hover:bg-brand-500 shadow-sm shadow-brand-500/20",
  secondary: "bg-neutral-800 text-neutral-100 hover:bg-neutral-700 border border-neutral-700/60",
  ghost: "bg-transparent text-neutral-300 hover:bg-neutral-800 hover:text-white",
  danger: "bg-red-600/90 text-white hover:bg-red-500",
  outline: "bg-transparent border border-neutral-700 text-neutral-200 hover:border-neutral-500 hover:bg-neutral-800/60",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] gap-1 rounded-md",
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-lg",
  icon: "h-9 w-9 rounded-lg",
  iconSm: "h-7 w-7 rounded-md",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        "inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
