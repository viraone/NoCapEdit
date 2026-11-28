import { describe, expect, it } from "vitest";
import {
  captionLines,
  isHandover,
  spokenName,
  findSets,
  oneEach,
  type Cue,
} from "@/lib/recap/performers";

describe("captionLines", () => {
  it("joins close cues and splits on punctuation", () => {
    const cues: Cue[] = [
      { start: 0, end: 1, text: "Hello" },
      { start: 1.5, end: 2, text: "world" },
      { start: 2.1, end: 3, text: "again." },
      { start: 2.5, end: 3, text: "split" },
    ];
    const lines = captionLines(cues);
    expect(lines.length).toBe(2);
    expect(lines[0].text).toBe("Hello world again.");
    expect(lines[1].text).toBe("split");
  });
});

describe("isHandover", () => {
  it("detects handovers", () => {
    expect(isHandover("Keep it going for Alex, everybody.")).toBe(true);
    expect(isHandover("Are you guys ready for our next comedian up tonight?")).toBe(true);
  });

  it("rejects non-handovers", () => {
    expect(isHandover("Round of applause.")).toBe(false);
    expect(isHandover("I keep going to the gym.")).toBe(false);
  });
});

describe("spokenName", () => {
  it("extracts name", () => {
    expect(spokenName("Keep it going for Sample Performer everybody!")).toBe("Sample Performer");
  });

  it("returns empty for stop words", () => {
    expect(spokenName("give it up for the host")).toBe("");
  });
});

describe("findSets", () => {
  it("splits show into sets", () => {
    const cues: Cue[] = [
      { start: 100, end: 105, text: "Intro" },
      { start: 530, end: 535, text: "Keep it going for Sample Performer everybody" },
      { start: 540, end: 545, text: "Give it up for Sample Performer" },
      { start: 700, end: 705, text: "Middle" },
      { start: 1160, end: 1165, text: "Welcome to the stage" },
      { start: 1170, end: 1175, text: "Next comedian" },
      { start: 1300, end: 1305, text: "End" },
    ];
    const sets = findSets(cues, 1800);
    expect(sets.length).toBe(3);
    expect(sets[0].name).toBe("Sample Performer");
    expect(sets[1].name).toBe("");
    expect(sets[2].name).toBe("");
  });

  it("drops short stretches", () => {
    const cues: Cue[] = [
      { start: 100, end: 105, text: "Intro" },
      { start: 530, end: 535, text: "Keep it going for Sample Performer everybody" },
      { start: 540, end: 545, text: "Give it up for Sample Performer" },
      { start: 600, end: 605, text: "Welcome to the stage" },
      { start: 610, end: 615, text: "Next comedian" },
      { start: 1300, end: 1305, text: "End" },
    ];
    const sets = findSets(cues, 1800);
    expect(sets.length).toBe(2);
  });
});

describe("oneEach", () => {
  it("picks biggest per set", () => {
    const sets = [
      { start: 0, end: 100, name: "" },
      { start: 100, end: 200, name: "" },
    ];
    const laughs = [
      { id: "a", start: 10, score: 1 },
      { id: "b", start: 20, score: 5 },
      { id: "c", start: 150, score: 2 },
    ];
    expect(oneEach(laughs, sets)).toEqual(["b", "c"]);
  });
});
