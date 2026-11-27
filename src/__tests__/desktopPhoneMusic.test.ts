import { describe, expect, it } from "vitest";
import { sameTrack, findTrack } from "../../desktop/lib/phone.mjs";

const node = (id: string, desc: string, y: number) => ({ text: "", desc, id, cls: "View", clickable: true, x: 540, y, w: 1080, h: 161 });

describe("sameTrack", () => {
  it("matches exact title and artist", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha,3:24", "Timber", "Pitbull")).toEqual({ title: "Timber", artist: "Pitbull, Kesha" });
  });

  it("matches case-insensitive", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha,3:24", "timber", "KESHA")).not.toBeNull();
  });

  it("matches full artist string", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha,3:24", "Timber", "Pitbull, Kesha")).not.toBeNull();
  });

  it("matches player bar (no length)", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha", "Timber", "Pitbull")).not.toBeNull();
  });

  it("matches explicit marker", () => {
    expect(sameTrack("Select track Time of Our Lives by Pitbull, Ne-Yo,explicit,3:49", "Time of Our Lives", "Ne-Yo")).toEqual({ title: "Time of Our Lives", artist: "Pitbull, Ne-Yo" });
  });

  it("rejects different artist", () => {
    expect(sameTrack("Select track Timber (Pitbull Tribute) by Iron Reich,3:03", "Timber", "Pitbull")).toBeNull();
  });

  it("rejects different artist 2", () => {
    expect(sameTrack("Select track Timber by The Jagged Edges,4:55", "Timber", "Pitbull")).toBeNull();
  });

  it("rejects partial artist name", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha,3:24", "Timber", "Pit")).toBeNull();
  });

  it("handles title with 'by'", () => {
    expect(sameTrack("Select track Stand by Me by Ben E. King,2:57", "Stand by Me", "Ben E. King")).toEqual({ title: "Stand by Me", artist: "Ben E. King" });
  });

  it("handles accents", () => {
    expect(sameTrack("Select track Déjà Vu by Beyoncé,4:00", "Deja Vu", "beyonce")).not.toBeNull();
  });

  it("handles curly quotes", () => {
    expect(sameTrack("Select track Don’t Stop the Party (feat. TJR) by Pitbull,3:26", "Don't Stop the Party (feat. TJR)", "Pitbull")).not.toBeNull();
  });

  it("rejects wrong prefix", () => {
    expect(sameTrack("Save Timber by Pitbull, Kesha", "Timber", "Pitbull")).toBeNull();
  });

  it("rejects empty title", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha,3:24", "", "Pitbull")).toBeNull();
  });

  it("rejects empty artist", () => {
    expect(sameTrack("Select track Timber by Pitbull, Kesha,3:24", "Timber", "")).toBeNull();
  });
});

describe("findTrack", () => {
  it("finds single match", () => {
    const nodes = [
      node("track_container", "Select track Timber by Pitbull, Kesha,3:24", 834),
      node("track_container", "Select track Time of Our Lives by Pitbull, Ne-Yo,explicit,3:49", 995),
      node("audio_browser_track_6_1", "Select track Timber by The Jagged Edges,4:55", 1800),
      node("", "Save Timber by Pitbull, Kesha", 2000),
    ];
    const res = findTrack(nodes, "Timber", "Pitbull");
    expect(res.count).toBe(1);
    expect(res.row?.y).toBe(834);
    expect(res.seen).toHaveLength(3);
    expect(res.seen[0]).toBe("Timber by Pitbull, Kesha,3:24");
  });

  it("returns null for multiple matches", () => {
    const nodes = [
      node("track_container", "Select track Timber by Pitbull, Kesha,3:24", 834),
      node("track_container", "Select track Timber by Pitbull, Kesha,3:24", 995),
    ];
    const res = findTrack(nodes, "Timber", "Pitbull");
    expect(res.count).toBe(2);
    expect(res.row).toBeNull();
  });

  it("returns null for no match", () => {
    const nodes = [
      node("track_container", "Select track Timber by Pitbull, Kesha,3:24", 834),
    ];
    const res = findTrack(nodes, "Fireball", "Pitbull");
    expect(res.count).toBe(0);
    expect(res.row).toBeNull();
  });

  it("ignores audio_bar_select_tap_target", () => {
    const nodes = [
      node("audio_bar_select_tap_target", "Select track Timber by Pitbull, Kesha", 100),
    ];
    const res = findTrack(nodes, "Timber", "Pitbull");
    expect(res.count).toBe(0);
    expect(res.seen).toEqual([]);
  });
});
