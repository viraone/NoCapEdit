import { describe, expect, it } from "vitest";
import { findHighlight, storyAgeMinutes, storyOwner } from "../../desktop/lib/phone.mjs";

const node = (id: string, text: string, x: number, y: number) => ({ text, desc: "", id, cls: "TextView", clickable: false, x, y, w: 100, h: 40 });

describe("reading a Story's heading", () => {
  it("storyOwner extracts the name", () => {
    expect(storyOwner("therickshawhaha's story, 10 hours ago")).toBe("therickshawhaha");
    expect(storyOwner("someone's story, 0 of 4, Seen.")).toBe("someone");
    expect(storyOwner("Profile picture")).toBeNull();
  });

  it("storyAgeMinutes calculates minutes", () => {
    expect(storyAgeMinutes("x's story, 54 seconds ago")).toBeCloseTo(0.9);
    expect(storyAgeMinutes("x's story, 1 minute ago")).toBe(1);
    expect(storyAgeMinutes("x's story, 2 minutes ago")).toBe(2);
    expect(storyAgeMinutes("x's story, 10 hours ago")).toBe(600);
    expect(storyAgeMinutes("x's story, 1 day ago")).toBe(1440);
    expect(storyAgeMinutes("x's story, just now")).toBe(0);
    expect(storyAgeMinutes("x's story, 0 of 4, Seen.")).toBeNull();
    expect(storyAgeMinutes("Profile picture")).toBeNull();
  });
});

describe("picking a Highlight by name", () => {
  const nodes = [
    node("username", "Open Mic", 150, 600),
    node("header_text", "Add to highlights", 540, 1900),
    node("username", "Shows", 150, 2276),
    node("username", "Open Mic", 390, 2276),
    node("username", "shows ", 630, 2276),
    node("other", "Open Mic", 870, 2276),
  ];

  it("finds highlights below header with matching name", () => {
    const res = findHighlight(nodes, "open mic");
    expect(res.count).toBe(1);
    expect(res.label?.x).toBe(390);
  });

  it("counts case-insensitive matches ignoring spaces", () => {
    const res = findHighlight(nodes, "Shows");
    expect(res.count).toBe(2);
  });

  it("returns null label for no matches", () => {
    const res = findHighlight(nodes, "Nope");
    expect(res.count).toBe(0);
    expect(res.label).toBeNull();
  });

  it("lists seen labels with coordinates", () => {
    const res = findHighlight(nodes, "x");
    expect(res.seen).toEqual(["Shows@150", "Open Mic@390", "shows@630"]);
  });
});
