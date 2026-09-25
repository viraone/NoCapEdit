import { describe, expect, it } from "vitest";
import { formatLocalStamp } from "@/lib/utils/time";

describe("formatLocalStamp", () => {
  it("formats YYYY-MM-DD HH-MM from local wall-clock getters, zero-padded", () => {
    expect(formatLocalStamp(new Date(2026, 0, 5, 9, 7))).toBe("2026-01-05 09-07");
    expect(formatLocalStamp(new Date(2026, 11, 31, 23, 59))).toBe("2026-12-31 23-59");
  });
  it("uses the current local time when no date is given", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(formatLocalStamp().startsWith(expected)).toBe(true);
  });
});
