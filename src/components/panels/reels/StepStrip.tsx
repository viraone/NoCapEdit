"use client";
import { Check, Loader2 } from "lucide-react";
import { cx } from "@/lib/utils/cx";

/**
 * The two-step strip on the Make reels cards: which step is under way (blue,
 * spinning), which is done (green tick) and which is still to come (grey).
 */
export function StepStrip({ step }: { step: 1 | 2 }) {
  const steps: { n: 1 | 2; label: string }[] = [
    { n: 1, label: "Subtitles" },
    { n: 2, label: "Reels" },
  ];
  return (
    <ol className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" aria-label={`Step ${step} of 2`} data-step-strip={step}>
      {steps.map((st, i) => {
        const state = st.n < step ? "done" : st.n === step ? "now" : "next";
        return (
          <li key={st.n} className="contents">
            {i > 0 && <span className="h-px w-3 bg-sys-gray3" aria-hidden />}
            <span
              className={cx(
                "flex items-center gap-1 rounded-full px-2 py-0.5",
                state === "now" && "bg-sys-blue text-white",
                state === "done" && "bg-sys-green/20 text-sys-green",
                state === "next" && "bg-sys-gray4 text-label-2",
              )}
              data-step-state={state}
            >
              {state === "done" ? <Check size={11} aria-hidden /> : state === "now" ? <Loader2 size={11} className="animate-spin" aria-hidden /> : null}
              {st.n}. {st.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
