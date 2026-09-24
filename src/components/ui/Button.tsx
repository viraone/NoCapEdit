"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/utils/cx";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
export type ButtonSize = "xs" | "sm" | "md" | "icon" | "iconSm";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-sys-blue text-white hover:bg-brand-400 disabled:hover:bg-sys-blue shadow-sm shadow-sys-blue/30",
  secondary: "bg-sys-gray4 text-white hover:bg-sys-gray3 border border-white/5",
  ghost: "bg-transparent text-label-2 hover:bg-sys-gray4 hover:text-white",
  danger: "bg-sys-red/15 text-sys-red hover:bg-sys-red/25 border border-sys-red/30",
  outline: "bg-sys-gray5 border border-sys-gray4 text-white hover:bg-sys-gray4",
};

const sizes: Record<ButtonSize, string> = {
  xs: "h-6 px-2 text-[11px] gap-1 rounded-md",
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-lg",
  md: "h-9 px-3.5 text-[13px] gap-2 rounded-[10px]",
  icon: "h-9 w-9 rounded-[10px]",
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
        "inline-flex items-center justify-center font-semibold whitespace-nowrap transition-colors select-none",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-sys-blue/60 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
});
