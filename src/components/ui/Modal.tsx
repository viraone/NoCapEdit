"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { cycleTarget, focusables } from "@/lib/a11y/focusTrap";

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  // Read every render so the effect below can depend on [open] alone and not
  // tear down and rebuild its listener whenever a re-render hands it a new
  // inline closure (that race is what let Escape slip past this dialog).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement;
    const first = focusables(bodyRef.current)[0] ?? dialogRef.current;
    first?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Consumed here, before it can reach anything behind the dialog.
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const list = focusables(dialogRef.current);
      const active = document.activeElement as HTMLElement | null;
      const target = cycleTarget(list.length, active ? list.indexOf(active) : -1, e.shiftKey);
      if (!target) return;
      e.preventDefault();
      (target === "first" ? list[0] : list[list.length - 1])?.focus();
    };
    // Capture phase: this dialog gets Escape/Tab before any handler behind it.
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (openerRef.current instanceof HTMLElement && openerRef.current.isConnected) openerRef.current.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`card w-full ${width} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between border-b border-sys-gray5 px-5 py-3">
          <h2 id={titleId} className="text-[13px] font-semibold">
            {title}
          </h2>
          <Button variant="ghost" size="iconSm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div ref={bodyRef} className="px-5 py-4">
          {children}
        </div>
      </div>
    </div>
  );
}
