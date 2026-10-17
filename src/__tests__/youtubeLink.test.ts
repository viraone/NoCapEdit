import { describe, expect, it } from "vitest";
import { formatFor, instagramShortcode, mediaUrl, parseMediaLink, youtubeVideoId, youtubeWatchUrl } from "@/lib/youtube/url";
// The helper is plain JavaScript; these tests pin its link rules to the site's.
import {
  availableHeights,
  canonicalMediaUrl,
  formatFor as helperFormatFor,
  formatSelector,
  instagramSelector,
  instagramShortcode as helperShortcode,
  outputArgs,
  outputFormat,
  parseMediaLink as helperParseMediaLink,
  safeTitle,
  youtubeVideoId as helperVideoId,
} from "../../server/youtube/lib.mjs";

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

const reels: [string, string | null][] = [
  ["https://www.instagram.com/reel/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  ["https://www.instagram.com/reel/C8Z0bXwyT7f/?igsh=MTd4YXRtZHg3bXF4Zg==", "C8Z0bXwyT7f"],
  ["https://www.instagram.com/reels/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  ["instagram.com/reel/C8Z0bXwyT7f", "C8Z0bXwyT7f"],
  ["https://www.instagram.com/p/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  ["https://www.instagram.com/tv/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  ["https://m.instagram.com/reel/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  ["https://instagr.am/p/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  // The app's "Copy link" sometimes puts the account in front.
  ["https://www.instagram.com/therickshawhaha/reel/C8Z0bXwyT7f/", "C8Z0bXwyT7f"],
  ["  https://www.instagram.com/reel/C8Z0bXwyT7f/  ", "C8Z0bXwyT7f"],
  // Not a single video: a profile, the explore page, a story, or an opaque share token.
  ["https://www.instagram.com/therickshawhaha/", null],
  ["https://www.instagram.com/explore/", null],
  ["https://www.instagram.com/stories/therickshawhaha/123/", null],
  ["https://www.instagram.com/share/reel/_abc123XYZ", null],
  ["https://notinstagram.com/reel/C8Z0bXwyT7f/", null],
  ["C8Z0bXwyT7f", null],
];

describe("instagram links", () => {
  it("finds the shortcode in the link shapes people paste", () => {
    for (const [link, code] of reels) expect(instagramShortcode(link), link).toBe(code);
  });

  it("the helper reads links the same way the site does", () => {
    for (const [link, code] of reels) expect(helperShortcode(link), link).toBe(code);
  });

  it("never mistakes one site's link for the other's", () => {
    for (const [link, id] of links) if (id) expect(instagramShortcode(link), link).toBeNull();
    for (const [link, code] of reels) if (code) expect(youtubeVideoId(link), link).toBeNull();
  });

  it("tells the two sites apart and builds one canonical link each", () => {
    expect(parseMediaLink("https://youtu.be/jNQXAC9IVRw")).toEqual({ source: "youtube", id: "jNQXAC9IVRw" });
    expect(parseMediaLink("https://www.instagram.com/reel/C8Z0bXwyT7f/?igsh=x")).toEqual({ source: "instagram", id: "C8Z0bXwyT7f" });
    expect(parseMediaLink("https://example.com/")).toBeNull();
    expect(helperParseMediaLink("https://www.instagram.com/reel/C8Z0bXwyT7f/")).toEqual({ source: "instagram", id: "C8Z0bXwyT7f" });
    expect(mediaUrl({ source: "instagram", id: "C8Z0bXwyT7f" })).toBe("https://www.instagram.com/reel/C8Z0bXwyT7f/");
    expect(mediaUrl({ source: "youtube", id: "jNQXAC9IVRw" })).toBe("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    expect(canonicalMediaUrl({ source: "instagram", id: "C8Z0bXwyT7f" })).toBe(mediaUrl({ source: "instagram", id: "C8Z0bXwyT7f" }));
  });
});

describe("youtube helper", () => {
  it("asks yt-dlp for H.264 + AAC up to the chosen height, defaulting to 1080", () => {
    expect(formatSelector(720)).toMatch(/^bv\*\[vcodec\^=avc1\]\[height<=720\]\+ba\[ext=m4a\]/);
    expect(formatSelector("999")).toContain("[height<=1080]");
    expect(formatSelector(undefined)).toContain("[height<=1080]");
  });

  it("fetches an Instagram reel at its full size, with no height cap", () => {
    expect(instagramSelector()).toMatch(/^bv\*\[vcodec\^=avc1\]\+ba\[ext=m4a\]/);
    expect(instagramSelector()).not.toContain("height");
    expect(outputArgs("mp4", 720, "instagram")).toEqual(["-f", instagramSelector(), "--merge-output-format", "mp4"]);
  });

  it("converts an Instagram reel to MP4 only, whatever is asked, and leaves YouTube's choice alone", () => {
    for (const asked of ["mp3", "MP3", "mp4", "", null, undefined]) expect(helperFormatFor("instagram", asked), String(asked)).toBe("mp4");
    expect(helperFormatFor("youtube", "mp3")).toBe("mp3");
    expect(helperFormatFor("youtube", "mp4")).toBe("mp4");
    expect(helperFormatFor("youtube", undefined)).toBe("mp4");
    expect(formatFor("instagram", "mp3")).toBe("mp4");
    expect(formatFor("youtube", "mp3")).toBe("mp3");
    expect(formatFor("youtube", "mp4")).toBe("mp4");
  });

  it("delivers an MP4 unless MP3 is asked for, then extracts the sound", () => {
    expect(outputFormat("mp3")).toBe("mp3");
    expect(outputFormat("MP3")).toBe("mp3");
    for (const f of ["mp4", "wav", "", null, undefined]) expect(outputFormat(f), String(f)).toBe("mp4");
    expect(outputArgs("mp4", 720)).toEqual(["-f", formatSelector(720), "--merge-output-format", "mp4"]);
    const mp3 = outputArgs("mp3", 720);
    expect(mp3).toContain("-x");
    expect(mp3.slice(mp3.indexOf("--audio-format"), mp3.indexOf("--audio-format") + 2)).toEqual(["--audio-format", "mp3"]);
    expect(mp3[1]).toMatch(/^ba\[ext=m4a\]/);
    expect(mp3).not.toContain("--merge-output-format");
  });

  it("lists the heights that have an H.264 rendition, best first", () => {
    const info = { formats: [{ height: 720, vcodec: "avc1.64001f" }, { height: 1080, vcodec: "vp09.00.40.08" }, { height: 360, vcodec: "avc1.42001e" }, { vcodec: "none" }] };
    expect(availableHeights(info)).toEqual([720, 480, 360]);
    expect(availableHeights({ formats: [] })).toEqual([1080, 720, 480, 360]);
  });

  it("makes a safe file name from the title", () => {
    expect(safeTitle('Me: at "the" zoo / 2005?')).toBe("Me at the zoo 2005");
    expect(safeTitle("")).toBe("Video");
    expect(safeTitle("", "Instagram reel")).toBe("Instagram reel");
  });
});
