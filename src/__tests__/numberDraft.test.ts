import { describe, expect, it } from "vitest";
import { parseNumberDraft } from "@/lib/utils/math";

describe("parseNumberDraft", () => {
  it("parses an ordinary number", () => {
    expect(parseNumberDraft("3.5")).toBe(3.5);
    expect(parseNumberDraft("  -2  ")).toBe(-2);
  });
  it("returns null for an empty or whitespace-only draft", () => {
    expect(parseNumberDraft("")).toBeNull();
    expect(parseNumberDraft("   ")).toBeNull();
  });
  it("returns null when the browser reports badInput, regardless of the string", () => {
    expect(parseNumberDraft("", true)).toBeNull();
    expect(parseNumberDraft("3.5", true)).toBeNull();
  });
  it("returns null for a string that is not a finite number", () => {
    expect(parseNumberDraft("abc")).toBeNull();
    expect(parseNumberDraft("Infinity")).toBeNull();
    expect(parseNumberDraft("NaN")).toBeNull();
  });
  it("parses an explicit zero", () => {
    expect(parseNumberDraft("0")).toBe(0);
  });
});
