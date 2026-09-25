/** 0:00.0 style timecode used in the UI. */
export function formatTime(seconds: number, withTenths = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  // Whole tenths first, so exact tenths (7.6 is 7.5999... in binary) are not shown one tenth low.
  const t = Math.floor(seconds * 10 + 1e-6);
  const m = Math.floor(t / 600);
  const s = Math.floor(t / 10) % 60;
  const tenths = t % 10;
  const base = `${m}:${s.toString().padStart(2, "0")}`;
  return withTenths ? `${base}.${tenths}` : base;
}

/** m:ss.cc transport timecode, rounded in whole centiseconds so 59.996 reads 1:00.00, never 0:60.00. */
export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const cs = Math.round(seconds * 100);
  const m = Math.floor(cs / 6000);
  const s = (cs % 6000) / 100;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

/** HH:MM:SS,mmm as required by SubRip. */
export function formatSrtTime(seconds: number): string {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(totalMs / 3_600_000);
  const m = Math.floor((totalMs % 3_600_000) / 60_000);
  const s = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s
    .toString()
    .padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

/** Parses "HH:MM:SS,mmm" or "MM:SS.mmm" into seconds. */
export function parseSrtTime(text: string): number {
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/);
  if (!m) return NaN;
  const h = Number(m[1] ?? 0);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const ms = Number(m[4].padEnd(3, "0"));
  return h * 3600 + min * 60 + s + ms / 1000;
}

/** "YYYY-MM-DD HH-MM" in local wall-clock time, for the recorder's default file name. */
export function formatLocalStamp(d: Date = new Date()): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}-${p2(d.getMinutes())}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`;
}

/** Current time in ms (kept out of render paths for the React Compiler lint). */
export function nowMs(): number {
  return Date.now();
}
