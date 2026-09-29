import { describe, expect, it } from "vitest";
import { creditFor, creditLine, licenseLabel, type MusicResult } from "@/lib/stock/openverse";

const track: MusicResult = { id: "1", title: "Halloween", artist: "SDM", artistUrl: null, pageUrl: "https://www.jamendo.com/track/1", url: "https://prod-1.storage.jamendo.com/?trackid=1", duration: 297, genres: ["rock"], license: "by-sa", licenseUrl: null, commercial: true, bytes: null };

describe("openverse music credits", () => {
  it("formats a Creative Commons credit line", () => {
    expect(licenseLabel("by-sa")).toBe("CC BY-SA");
    expect(creditLine(creditFor(track))).toBe('"Halloween" by SDM (CC BY-SA) · https://www.jamendo.com/track/1');
  });
});
