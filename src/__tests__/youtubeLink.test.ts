import { describe, expect, it } from "vitest";
import { youtubeVideoId, youtubeWatchUrl } from "@/lib/youtube/url";
// The helper is plain JavaScript; these tests pin its link rules to the site's.
import { availableHeights, formatSelector, safeTitle, youtubeVideoId as helperVideoId } from "../../server/youtube/lib.mjs";

const links: [string, string | null][] = [
  ["https://www.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["https://youtube.com/watch?v=jNQXAC9IVRw&list=PL123&t=20s", "jNQXAC9IVRw"],
  ["https://youtu.be/jNQXAC9IVRw?si=abc", "jNQXAC9IVRw"],
  ["youtu.be/jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["https://www.youtube.com/shorts/jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["https://m.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["https://music.youtube.com/watch?v=jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["https://www.youtube.com/embed/jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["https://www.youtube.com/live/jNQXAC9IVRw", "jNQXAC9IVRw"],
  ["  https://www.youtube.com/watch?v=jNQXAC9IVRw  ", "jNQXAC9IVRw"],
  ["https://www.youtube.com/playlist?list=PL123", null],
  ["https://www.youtube.com/watch?v=short", null],
  ["https://example.com/watch?v=jNQXAC9IVRw", null],
  ["https://notyoutube.com/watch?v=jNQXAC9IVRw", null],
  ["jNQXAC9IVRw", null],
  ["", null],
  ["javascript:alert(1)", null],
];

describe("youtube links", () => {
  it("finds the video id in the link shapes people paste", () => {
    for (const [link, id] of links) expect(youtubeVideoId(link), link).toBe(id);
  });

  it("the helper reads links the same way the site does", () => {
    for (const [link, id] of links) expect(helperVideoId(link), link).toBe(id);
  });

  it("hands the helper one canonical link", () => {
    expect(youtubeWatchUrl("jNQXAC9IVRw")).toBe("https://www.youtube.com/watch?v=jNQXAC9IVRw");
  });
});

describe("youtube helper", () => {
  it("asks yt-dlp for H.264 + AAC up to the chosen height, defaulting to 1080", () => {
    expect(formatSelector(720)).toMatch(/^bv\*\[vcodec\^=avc1\]\[height<=720\]\+ba\[ext=m4a\]/);
    expect(formatSelector("999")).toContain("[height<=1080]");
    expect(formatSelector(undefined)).toContain("[height<=1080]");
  });

  it("lists the heights that have an H.264 rendition, best first", () => {
    const info = { formats: [{ height: 720, vcodec: "avc1.64001f" }, { height: 1080, vcodec: "vp09.00.40.08" }, { height: 360, vcodec: "avc1.42001e" }, { vcodec: "none" }] };
    expect(availableHeights(info)).toEqual([720, 480, 360]);
    expect(availableHeights({ formats: [] })).toEqual([1080, 720, 480, 360]);
  });

  it("makes a safe file name from the title", () => {
    expect(safeTitle('Me: at "the" zoo / 2005?')).toBe("Me at the zoo 2005");
    expect(safeTitle("")).toBe("YouTube video");
  });
});
