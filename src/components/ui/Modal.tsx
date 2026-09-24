"use client";
import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export function Modal({ open, onClose, title, children, width = "max-w-lg" }: { open: boolean; onClose: () => void; title: string; children: ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className={`card w-full ${width} max-h-[90vh] overflow-y-auto`}>
        <div className="flex items-center justify-between border-b border-sys-gray5 px-5 py-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <Button variant="ghost" size="iconSm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </Button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
