import { describe, expect, it } from "vitest";
import { cuesToSrt, cuesToText, formatClock, normalizeCues, srtTime, transcriptFileName } from "@/lib/documentary/transcript";
import { parseVtt, safeLang, transcriptArgs } from "../../server/youtube/lib.mjs";

describe("formatClock", () => {
  it("formats M:SS and H:MM:SS", () => {
    expect(formatClock(65)).toBe("1:05");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(NaN)).toBe("0:00");
    expect(formatClock(-1)).toBe("0:00");
  });
});

describe("cuesToText", () => {
  it("joins close cues and splits on a 3 second pause", () => {
    expect(cuesToText([{ start: 0, end: 1, text: "Hello" }, { start: 2, end: 3, text: "world" }])).toBe("Hello world");
    expect(cuesToText([{ start: 0, end: 1, text: "Hello" }, { start: 4, end: 5, text: "world" }])).toBe("Hello\n\nworld");
  });
  it("prefixes timestamps when asked", () => {
    const cues = [{ start: 0, end: 2, text: "Hello" }, { start: 10, end: 12, text: "world" }];
    expect(cuesToText(cues, { timestamps: true })).toBe("[0:00] Hello\n\n[0:10] world");
  });
  it("breaks a long paragraph at a sentence end", () => {
    const long = `${"word ".repeat(110).trim()}.`;
    const out = cuesToText([{ start: 0, end: 5, text: long }, { start: 5, end: 6, text: "Next." }]);
    expect(out).toBe(`${long}\n\nNext.`);
  });
  it("is empty for no cues", () => {
    expect(cuesToText([])).toBe("");
  });
});

describe("srt", () => {
  it("formats times", () => {
    expect(srtTime(3661.5)).toBe("01:01:01,500");
    expect(srtTime(-1)).toBe("00:00:00,000");
  });
  it("builds a standard file", () => {
    const cues = [{ start: 1, end: 2.5, text: "Hello" }, { start: 2.5, end: 4, text: "World" }];
    expect(cuesToSrt(cues)).toBe("1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:02,500 --> 00:00:04,000\nWorld\n");
    expect(cuesToSrt([])).toBe("");
  });
});

describe("transcriptFileName", () => {
  it("cleans the title", () => {
    expect(transcriptFileName("What? A: Title/2024", "txt")).toBe("What A Title 2024.txt");
    expect(transcriptFileName("", "srt")).toBe("transcript.srt");
  });
});

describe("normalizeCues", () => {
  it("keeps only valid cues, trimmed, in order", () => {
    const input = [{ start: 0, end: 1, text: "  Hello  " }, { start: 2, end: 1, text: "bad" }, { start: "x", end: 3, text: "bad" }, { start: 4, end: 5, text: " " }, { start: 6, end: 7, text: "world" }];
    expect(normalizeCues(input)).toEqual([{ start: 0, end: 1, text: "Hello" }, { start: 6, end: 7, text: "world" }]);
    expect(normalizeCues(null)).toEqual([]);
  });
});

describe("helper: safeLang and transcriptArgs", () => {
  it("only lets language tags through", () => {
    expect(safeLang("en")).toBe("en");
    expect(safeLang("pt-BR")).toBe("pt-BR");
    expect(safeLang("../x")).toBe("en");
    expect(safeLang("")).toBe("en");
    expect(safeLang(undefined)).toBe("en");
  });
  it("asks yt-dlp for captions only", () => {
    expect(transcriptArgs("fr", "/t/sub")).toEqual(["--skip-download", "--no-playlist", "--write-subs", "--write-auto-subs", "--sub-langs", "fr", "--sub-format", "vtt", "-o", "/t/sub"]);
  });
});

describe("helper: parseVtt", () => {
  it("collapses YouTube's rolling auto captions", () => {
    const input = [
      "WEBVTT", "Kind: captions", "Language: en", "",
      "00:00:00.320 --> 00:00:03.000 align:start position:0%",
      "hello and welcome<00:00:01.000><c> to</c><00:00:01.500><c> the</c><00:00:02.000><c> show</c>", "",
      "00:00:03.000 --> 00:00:03.010 align:start position:0%", "hello and welcome to the show", " ", "",
      "00:00:03.010 --> 00:00:05.500 align:start position:0%", "hello and welcome to the show", "today we&#39;ll talk about<00:00:04.000><c> cats</c>", "",
      "00:00:05.500 --> 00:00:05.510 align:start position:0%", "today we'll talk about cats", " ", "",
      "00:00:05.510 --> 00:00:08.000 align:start position:0%", "today we'll talk about cats", "and dogs &amp; birds",
    ].join("\n");
    expect(parseVtt(input)).toEqual([
      { start: 0.32, end: 3, text: "hello and welcome to the show" },
      { start: 3.01, end: 5.5, text: "today we'll talk about cats" },
      { start: 5.51, end: 8, text: "and dogs & birds" },
    ]);
  });
  it("reads manual captions with identifiers and MM:SS times", () => {
    const input = ["WEBVTT", "", "1", "00:01.000 --> 00:02.500", "First line.", "", "2", "00:02.500 --> 00:04.000", "Second line.", "", "NOTE ignore me", "", "3", "01:00:00.000 --> 01:00:01.000", "An hour in."].join("\n");
    expect(parseVtt(input)).toEqual([{ start: 1, end: 2.5, text: "First line." }, { start: 2.5, end: 4, text: "Second line." }, { start: 3600, end: 3601, text: "An hour in." }]);
  });
  it("is empty for empty input", () => {
    expect(parseVtt("")).toEqual([]);
    expect(parseVtt("WEBVTT\n")).toEqual([]);
  });
});
