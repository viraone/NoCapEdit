import { describe, expect, it } from "vitest";
import type { ScheduleWanted } from "@/lib/schedule/scheduleBridge";
import { clockText, fromLocalInput, HEADS_UP_MS, nextHour, statusLabel, summaryLines, toLocalInput, whenText } from "@/lib/schedule/scheduleForm";

/** A local date and time, so these tests read the same in every time zone. */
const local = (year: number, month: number, day: number, hour: number, minute = 0, second = 0, ms = 0) =>
  new Date(year, month - 1, day, hour, minute, second, ms).getTime();

function wanted(overrides: Partial<ScheduleWanted> = {}): ScheduleWanted {
  return {
    at: local(2026, 12, 4, 19),
    audience: "story",
    highlight: "",
    options: { mute: false, overlay: "", overlayAt: "top", linkUrl: "", linkLabel: "", linkAt: "bottom", music: null },
    ...overrides,
  };
}

describe("nextHour", () => {
  it("picks the next full hour when it is more than five minutes away", () => {
    expect(nextHour(local(2026, 12, 4, 18, 50))).toBe(local(2026, 12, 4, 19));
  });

  it("accepts a full hour exactly five minutes away", () => {
    expect(nextHour(local(2026, 12, 4, 18, 55))).toBe(local(2026, 12, 4, 19));
  });

  it("skips to the following hour when the next one is less than five minutes away", () => {
    expect(nextHour(local(2026, 12, 4, 18, 56))).toBe(local(2026, 12, 4, 20));
  });

  it("moves past midnight", () => {
    expect(nextHour(local(2026, 12, 4, 23, 50))).toBe(local(2026, 12, 5, 0));
    expect(nextHour(local(2026, 12, 4, 23, 59))).toBe(local(2026, 12, 5, 1));
  });

  it("uses the five-minute lead", () => {
    expect(HEADS_UP_MS).toBe(5 * 60_000);
  });
});

describe("toLocalInput / fromLocalInput", () => {
  it("writes a local datetime-local value", () => {
    expect(toLocalInput(local(2026, 1, 2, 3, 4))).toBe("2026-01-02T03:04");
    expect(toLocalInput(local(2026, 12, 31, 23, 59))).toBe("2026-12-31T23:59");
  });

  it("reads a local datetime-local value back", () => {
    expect(fromLocalInput("2026-12-04T19:05")).toBe(local(2026, 12, 4, 19, 5));
    expect(fromLocalInput("  2026-12-04T19:05  ")).toBe(local(2026, 12, 4, 19, 5));
  });

  it("round trips every minute of a day", () => {
    const first = local(2026, 7, 15, 0, 0);
    for (let minute = 0; minute < 24 * 60; minute++) {
      const at = first + minute * 60_000;
      expect(fromLocalInput(toLocalInput(at))).toBe(at);
    }
  });

  it("returns null for text that is not a real local date and time", () => {
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("nope")).toBeNull();
    expect(fromLocalInput("2026-1-2T03:04")).toBeNull();
    expect(fromLocalInput("2026-12-04 19:05")).toBeNull();
    expect(fromLocalInput("2026-13-01T10:00")).toBeNull();
    expect(fromLocalInput("2026-02-30T10:00")).toBeNull();
    expect(fromLocalInput("2026-12-04T24:00")).toBeNull();
    expect(fromLocalInput("2026-12-04T10:60")).toBeNull();
  });
});

describe("clockText", () => {
  it("uses a 12-hour clock", () => {
    expect(clockText(local(2026, 12, 4, 19, 0))).toBe("7:00 PM");
    expect(clockText(local(2026, 12, 4, 0, 5))).toBe("12:05 AM");
    expect(clockText(local(2026, 12, 4, 12, 0))).toBe("12:00 PM");
  });
});

describe("whenText", () => {
  const now = local(2026, 12, 4, 18, 30);

  it("says Today for the same local day", () => {
    expect(whenText(local(2026, 12, 4, 19), now)).toBe("Today 7:00 PM");
  });

  it("says Tomorrow for the next local day", () => {
    expect(whenText(local(2026, 12, 5, 19), now)).toBe("Tomorrow 7:00 PM");
  });

  it("names the weekday and month for later days", () => {
    expect(whenText(local(2026, 12, 11, 19), now)).toBe("Fri, Dec 11, 7:00 PM");
    expect(whenText(local(2027, 1, 2, 9, 5), now)).toBe("Sat, Jan 2, 9:05 AM");
  });

  it("treats midnight tonight as tomorrow", () => {
    expect(whenText(local(2026, 12, 5, 0, 10), local(2026, 12, 4, 23, 55))).toBe("Tomorrow 12:10 AM");
  });
});

describe("statusLabel", () => {
  it("names every status", () => {
    expect(statusLabel({ status: "scheduled" })).toBe("Waiting");
    expect(statusLabel({ status: "posting" })).toBe("Setting up");
    expect(statusLabel({ status: "sharing" })).toBe("Sharing");
    expect(statusLabel({ status: "shared" })).toBe("Shared");
    expect(statusLabel({ status: "needsYou" })).toBe("Needs you");
    expect(statusLabel({ status: "missed" })).toBe("Missed");
  });
});

describe("summaryLines", () => {
  it("always says who sees it, and nothing that is not set", () => {
    expect(summaryLines(wanted())).toEqual(["Share to: Your story."]);
    expect(summaryLines(wanted({ audience: "close" }))).toEqual(["Share to: Close Friends."]);
  });

  it("lines up the link, text, song, mute and Highlight that are set", () => {
    const lines = summaryLines(
      wanted({
        audience: "close",
        highlight: "  Open mic  ",
        options: {
          mute: true,
          overlay: "  Friday night  ",
          overlayAt: "middle",
          linkUrl: "  example.com/tickets  ",
          linkLabel: "  SIGN UP NOW  ",
          linkAt: "top",
          music: { title: "Timber", artist: "Pitbull" },
        },
      }),
    );
    expect(lines).toEqual([
      "Share to: Close Friends.",
      'Link sticker: "SIGN UP NOW" to example.com/tickets, at the top.',
      'Text on the picture: "Friday night", in the middle.',
      'Music from Instagram: "Timber" by Pitbull.',
      "The video's sound is muted.",
      'Added to the Highlight "Open mic".',
    ]);
  });

  it("shows a link without words when only the address is set", () => {
    const lines = summaryLines(
      wanted({
        options: { mute: false, overlay: "", overlayAt: "top", linkUrl: "example.com", linkLabel: "   ", linkAt: "bottom", music: null },
      }),
    );
    expect(lines).toEqual(["Share to: Your story.", "Link sticker: example.com, at the bottom."]);
  });

  it("counts an Instagram song as the sound being muted", () => {
    const lines = summaryLines(
      wanted({
        options: { mute: false, overlay: "", overlayAt: "top", linkUrl: "", linkLabel: "", linkAt: "bottom", music: { title: "Song", artist: "Artist" } },
      }),
    );
    expect(lines).toContain('Music from Instagram: "Song" by Artist.');
    expect(lines).toContain("The video's sound is muted.");
  });
});
