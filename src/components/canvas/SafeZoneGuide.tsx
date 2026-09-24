import { SAFE_ZONES, type SafeZoneKind } from "@/lib/models/formats";

/** Translucent masks showing where a platform's UI covers the video. */
export function SafeZoneGuide({ kind }: { kind: SafeZoneKind }) {
  if (kind === "none") return null;
  const z = SAFE_ZONES[kind];
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const mask = "absolute bg-black/45";
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <div className={mask} style={{ left: 0, right: 0, top: 0, height: pct(z.top) }} />
      <div className={mask} style={{ left: 0, right: 0, bottom: 0, height: pct(z.bottom) }} />
      <div className={mask} style={{ left: 0, width: pct(z.left), top: pct(z.top), bottom: pct(z.bottom) }} />
      <div className={mask} style={{ right: 0, width: pct(z.right), top: pct(z.top), bottom: pct(z.bottom) }} />
      <div
        className="absolute border border-dashed border-emerald-400/70"
        style={{ left: pct(z.left), right: pct(z.right), top: pct(z.top), bottom: pct(z.bottom) }}
      >
        <span className="absolute left-1 top-1 rounded bg-emerald-500/80 px-1 text-[9px] font-medium text-black">{z.label} safe area</span>
      </div>
    </div>
  );
}
