"use client";
import { useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/utils/cx";

export function FileDrop({ accept, multiple, onFiles, children, className, disabled }: { accept: string; multiple?: boolean; onFiles: (files: File[]) => void; children: ReactNode; className?: string; disabled?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => !disabled && inputRef.current?.click()}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && !disabled && inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(multiple ? files : files.slice(0, 1));
      }}
      className={cx(
        "cursor-pointer rounded-lg border border-dashed px-4 py-5 text-center transition-colors",
        over ? "border-brand-500 bg-brand-500/10" : "border-neutral-700 hover:border-neutral-500 hover:bg-neutral-800/40",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) onFiles(files);
        }}
      />
      {children}
    </div>
  );
}
