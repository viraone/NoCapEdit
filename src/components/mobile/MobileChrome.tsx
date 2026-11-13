"use client";
import { cx } from "@/lib/utils/cx";

/** Primary call-to-action: brand gradient pill. */
export function PrimaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-[54px] w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-brand-500 to-sys-indigo text-[17px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(10,132,255,0.7)] transition active:scale-[0.98] disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.06] px-5 text-[15px] font-semibold text-white transition active:bg-white/10 disabled:opacity-50",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * The screen's main action, pinned to the bottom of the viewport. Sits
 * above the home indicator and, on iPhone, above Safari's floating address
 * bar, which otherwise covers a button that scrolls to the very bottom.
 */
export function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-4 bg-[linear-gradient(to_top,black_78%,transparent)] px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-7">
      {children}
    </div>
  );
}

/** iOS-style segmented control. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { value: T; label: React.ReactNode; aria?: string }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("inline-flex rounded-full bg-white/[0.06] p-1", className)} role="tablist">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            className={cx(
              "flex-1 rounded-full font-semibold transition",
              size === "sm" ? "px-3 py-1 text-[13px]" : "px-3.5 py-1.5 text-[14px]",
              active ? "bg-white text-black shadow-sm" : "text-label-2 active:text-white",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={cx("relative h-[30px] w-[50px] shrink-0 rounded-full transition", on ? "bg-sys-green" : "bg-white/15")}
    >
      <span className={cx("absolute top-[3px] h-6 w-6 rounded-full bg-white shadow transition", on ? "left-[23px]" : "left-[3px]")} />
    </button>
  );
}
