"use client";
import { createContext, forwardRef, useContext, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

/** The ids a Field hands its child control, so the label is explicitly (not just structurally) associated with it. */
export interface FieldControl {
  id: string;
  captionId: string;
  hintId?: string;
}

const FieldControlContext = createContext<FieldControl | null>(null);

/** Read by NumberInput/Select/Input to wire id + aria-labelledby to the Field that wraps them. Null outside a Field. */
export function useFieldControl(): FieldControl | null {
  return useContext(FieldControlContext);
}

export function Field({ label, hint, right, children, className }: { label: string; hint?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  const controlId = useId();
  const captionId = useId();
  const hintId = useId();
  const control: FieldControl = { id: controlId, captionId, hintId: hint ? hintId : undefined };
  return (
    // htmlFor names the one control this field labels: a plain click on the caption, the header strip or the
    // margin focuses that control (and edits nothing else), even when `right` renders an interactive element
    // (a "playhead" button) ahead of it in DOM order — the label-activation algorithm skips those.
    <label htmlFor={controlId} className={cx("block", className)}>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span id={captionId} className="caps">
          {label}
        </span>
        {right && <span className="text-[11px] tabular-nums text-label-2">{right}</span>}
      </div>
      <FieldControlContext.Provider value={control}>{children}</FieldControlContext.Provider>
      {hint && (
        <p id={control.hintId} className="mt-1.5 text-[11px] leading-snug text-label-3">
          {hint}
        </p>
      )}
    </label>
  );
}

export const inputClass =
  "w-full h-8 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 text-[13px] text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 disabled:opacity-50";

export const textareaClass =
  "w-full min-h-16 rounded-lg border border-sys-gray4 bg-sys-gray5 px-2.5 py-1.5 text-[13px] leading-snug text-white placeholder:text-label-3 focus:border-sys-blue focus:outline-none focus:ring-1 focus:ring-sys-blue/50 resize-y";

/** A raw text/password input styled like the shared fields, wired to its enclosing Field when there is one. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, id, ...props }, ref) {
  const field = useFieldControl();
  return <input ref={ref} id={id ?? field?.id} aria-labelledby={field?.captionId} className={cx(inputClass, className)} {...props} />;
});
