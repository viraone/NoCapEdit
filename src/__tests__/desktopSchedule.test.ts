import { describe, expect, it } from "vitest";
import {
  LATE_LIMIT_MS,
  HEADS_UP_MS,
  GAP_AFTER_SHARE_MS,
  POSTPONE_MS,
  MIN_LEAD_MS,
  MAX_AHEAD_MS,
  emptyQueue,
  parseWanted,
  newItem,
  markMissed,
  dueItem,
  headsUp,
  recover,
  postponed,
  keepsRunning,
  parseQueue,
} from "../../desktop/lib/schedule.mjs";

type Slot = "top" | "middle" | "bottom";
type Status = "scheduled" | "posting" | "sharing" | "shared" | "needsYou" | "missed";
type StoryOptions = {
  mute: boolean;
  overlay: string;
  overlayAt: Slot;
  linkUrl: string;
  linkLabel: string;
  linkAt: Slot;
  music: { title: string; artist: string } | null;
};
type Wanted = {
  at: number;
  audience: "story" | "close";
  highlight: string;
  options: StoryOptions;
};
type Item = Wanted & {
  id: string;
  name: string;
  source: "picture" | "video";
  status: Status;
  note: string;
  details: string[];
  warned: boolean;
  maybePosted: boolean;
  createdAt: number;
  finishedAt: number | null;
};

const NOW = 1_800_000_000_000;

function baseOptions(): StoryOptions {
  return {
    mute: false,
    overlay: "",
    overlayAt: "top",
    linkUrl: "",
    linkLabel: "",
    linkAt: "bottom",
    music: null,
  };
}

function baseWanted(at: number): Wanted {
  return { at, audience: "story", highlight: "", options: baseOptions() };
}

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "abc",
    name: "Story",
    source: "video",
    status: "scheduled",
    note: "",
    details: [],
    warned: false,
    maybePosted: false,
    createdAt: NOW,
    finishedAt: null,
    at: NOW,
    audience: "story",
    highlight: "",
    options: baseOptions(),
    ...overrides,
  };
}

describe("constants", () => {
  it("have expected values", () => {
    expect(LATE_LIMIT_MS).toBe(30 * 60_000);
    expect(HEADS_UP_MS).toBe(5 * 60_000);
    expect(GAP_AFTER_SHARE_MS).toBe(2 * 60_000);
    expect(POSTPONE_MS).toBe(15 * 60_000);
    expect(MIN_LEAD_MS).toBe(60_000);
    expect(MAX_AHEAD_MS).toBe(365 * 24 * 60 * 60_000);
  });
});

describe("emptyQueue", () => {
  it("returns a fresh empty queue", () => {
    expect(emptyQueue()).toEqual({ paused: false, lastSharedAt: null, items: [] });
  });
});

describe("parseWanted", () => {
  it("rejects non-object raw", () => {
    expect(parseWanted(null, NOW)).toEqual({ ok: false, why: "Pick a day and time." });
    expect(parseWanted(5, NOW)).toEqual({ ok: false, why: "Pick a day and time." });
  });

  it("rejects non-finite at", () => {
    expect(parseWanted({ at: "x" }, NOW)).toEqual({ ok: false, why: "Pick a day and time." });
    expect(parseWanted({ at: Infinity }, NOW)).toEqual({ ok: false, why: "Pick a day and time." });
  });

  it("rejects too soon", () => {
    expect(parseWanted({ at: NOW + MIN_LEAD_MS - 1 }, NOW)).toEqual({
      ok: false,
      why: "Pick a time at least a minute from now.",
    });
  });

  it("rejects too far ahead", () => {
    expect(parseWanted({ at: NOW + MAX_AHEAD_MS + 1 }, NOW)).toEqual({
      ok: false,
      why: "Pick a time within a year.",
    });
  });

  it("rejects half-filled music", () => {
    expect(
      parseWanted({ at: NOW + MIN_LEAD_MS, options: { music: { title: "Song", artist: "  " } } }, NOW),
    ).toEqual({ ok: false, why: "Type both the song and the artist." });
  });

  it("rejects bad link", () => {
    expect(
      parseWanted({ at: NOW + MIN_LEAD_MS, options: { linkUrl: "not a link" } }, NOW),
    ).toEqual({ ok: false, why: "The link is not a web address the phone can type." });
  });

  it("accepts a full success and forces mute on with music", () => {
    const result = parseWanted(
      {
        at: NOW + MIN_LEAD_MS,
        audience: "close",
        highlight: "  Trip  ",
        options: {
          mute: false,
          overlay: "  hi  ",
          overlayAt: "middle",
          linkUrl: "  example.com/x  ",
          linkLabel: "  Visit  ",
          linkAt: "top",
          music: { title: "  My   Song  ", artist: "  Artist  " },
        },
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      at: NOW + MIN_LEAD_MS,
      audience: "close",
      highlight: "Trip",
      options: {
        mute: true,
        overlay: "hi",
        overlayAt: "middle",
        linkUrl: "example.com/x",
        linkLabel: "Visit",
        linkAt: "top",
        music: { title: "My Song", artist: "Artist" },
      },
    });
  });

  it("defaults audience and slots", () => {
    const result = parseWanted({ at: NOW + MIN_LEAD_MS }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.audience).toBe("story");
    expect(result.value.options.overlayAt).toBe("top");
    expect(result.value.options.linkAt).toBe("bottom");
    expect(result.value.options.music).toBeNull();
  });
});

describe("newItem", () => {
  it("builds a scheduled item with defaults", () => {
    const item = newItem("id1", "  My Story  ", "picture", baseWanted(NOW + 1000), NOW);
    expect(item.name).toBe("My Story");
    expect(item.source).toBe("picture");
    expect(item.status).toBe("scheduled");
    expect(item.note).toBe("");
    expect(item.details).toEqual([]);
    expect(item.warned).toBe(false);
    expect(item.maybePosted).toBe(false);
    expect(item.createdAt).toBe(NOW);
    expect(item.finishedAt).toBeNull();
  });

  it("falls back to Story when name empty", () => {
    const item = newItem("id1", "   ", "video", baseWanted(NOW + 1000), NOW);
    expect(item.name).toBe("Story");
  });
});

describe("markMissed", () => {
  it("does not miss at exactly the limit", () => {
    const queue = { ...emptyQueue(), items: [makeItem({ at: NOW - LATE_LIMIT_MS })] };
    const result = markMissed(queue, NOW);
    expect(result.missed).toEqual([]);
    expect(result.queue).toBe(queue);
  });

  it("misses one ms after the limit", () => {
    const queue = { ...emptyQueue(), items: [makeItem({ at: NOW - LATE_LIMIT_MS - 1 })] };
    const result = markMissed(queue, NOW);
    expect(result.missed.length).toBe(1);
    expect(result.missed[0].status).toBe("missed");
    expect(result.missed[0].note).toContain("Nothing was posted.");
  });

  it("applies even when paused", () => {
    const queue = { paused: true, lastSharedAt: null, items: [makeItem({ at: NOW - LATE_LIMIT_MS - 1 })] };
    const result = markMissed(queue, NOW);
    expect(result.missed.length).toBe(1);
  });
});

describe("dueItem", () => {
  it("null when paused", () => {
    const queue = { paused: true, lastSharedAt: null, items: [makeItem({ at: NOW })] };
    expect(dueItem(queue, NOW)).toBeNull();
  });

  it("null when busy", () => {
    const queue = { ...emptyQueue(), items: [makeItem({ status: "posting" }), makeItem({ at: NOW })] };
    expect(dueItem(queue, NOW)).toBeNull();
  });

  it("null during gap after share", () => {
    const queue = { ...emptyQueue(), lastSharedAt: NOW - GAP_AFTER_SHARE_MS + 1, items: [makeItem({ at: NOW })] };
    expect(dueItem(queue, NOW)).toBeNull();
  });

  it("picks earliest due", () => {
    const a = makeItem({ id: "a", at: NOW - 100 });
    const b = makeItem({ id: "b", at: NOW - 200 });
    const queue = { ...emptyQueue(), items: [a, b] };
    expect(dueItem(queue, NOW)?.id).toBe("b");
  });

  it("null when not yet due", () => {
    const queue = { ...emptyQueue(), items: [makeItem({ at: NOW + 1 })] };
    expect(dueItem(queue, NOW)).toBeNull();
  });
});

describe("headsUp", () => {
  it("empty when paused", () => {
    const queue = { paused: true, lastSharedAt: null, items: [makeItem({ at: NOW + HEADS_UP_MS })] };
    expect(headsUp(queue, NOW)).toEqual([]);
  });

  it("includes at window start edge, excludes warned and past-at", () => {
    const inWindow = makeItem({ id: "a", at: NOW + HEADS_UP_MS });
    const warned = makeItem({ id: "b", at: NOW + HEADS_UP_MS, warned: true });
    const pastAt = makeItem({ id: "c", at: NOW });
    const queue = { ...emptyQueue(), items: [inWindow, warned, pastAt] };
    expect(headsUp(queue, NOW).map((i) => i.id)).toEqual(["a"]);
  });
});

describe("recover", () => {
  it("converts posting and sharing to needsYou", () => {
    const queue = {
      ...emptyQueue(),
      items: [makeItem({ id: "p", status: "posting" }), makeItem({ id: "s", status: "sharing" })],
    };
    const result = recover(queue);
    const p = result.items.find((i) => i.id === "p");
    const s = result.items.find((i) => i.id === "s");
    expect(p?.status).toBe("needsYou");
    expect(p?.maybePosted).toBe(false);
    expect(p?.note).toContain("Nothing was shared.");
    expect(s?.status).toBe("needsYou");
    expect(s?.maybePosted).toBe(true);
    expect(s?.note).toContain("Check Instagram");
  });
});

describe("postponed", () => {
  it("moves a scheduled item forward", () => {
    const item = makeItem({ at: NOW - 1000, warned: true });
    const result = postponed(item, NOW);
    expect(result.at).toBe(NOW + POSTPONE_MS);
    expect(result.warned).toBe(false);
  });

  it("leaves a shared item unchanged", () => {
    const item = makeItem({ status: "shared", at: NOW - 1000 });
    expect(postponed(item, NOW)).toBe(item);
  });
});

describe("keepsRunning", () => {
  it("true when posting", () => {
    expect(keepsRunning({ ...emptyQueue(), items: [makeItem({ status: "posting" })] })).toBe(true);
  });
  it("true when scheduled and not paused", () => {
    expect(keepsRunning({ ...emptyQueue(), items: [makeItem()] })).toBe(true);
  });
  it("false when paused with only scheduled", () => {
    expect(keepsRunning({ paused: true, lastSharedAt: null, items: [makeItem()] })).toBe(false);
  });
});

describe("parseQueue", () => {
  it("null on bad text", () => {
    expect(parseQueue("not json")).toBeNull();
    expect(parseQueue("[]")).toBeNull();
    expect(parseQueue(JSON.stringify({ items: "x" }))).toBeNull();
  });

  it("drops bad items", () => {
    const text = JSON.stringify({
      paused: false,
      lastSharedAt: null,
      items: [
        { id: "bad id!", at: NOW, status: "scheduled", options: {} },
        { id: "ok", at: NOW, status: "scheduled", options: {} },
      ],
    });
    const queue = parseQueue(text);
    expect(queue?.items.length).toBe(1);
    expect(queue?.items[0].id).toBe("ok");
  });

  it("round trips a good queue", () => {
    const queue = {
      paused: true,
      lastSharedAt: NOW,
      items: [newItem("id1", "Hi", "picture", baseWanted(NOW + 1000), NOW)],
    };
    const parsed = parseQueue(JSON.stringify(queue));
    expect(parsed).toEqual(queue);
  });
});
