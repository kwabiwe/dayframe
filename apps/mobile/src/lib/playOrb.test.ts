import { describe, expect, it } from "vitest";
import { PLAY_ORB, bloomActivities, bloomHit, bloomSpots, type BloomActivity } from "./playOrb";

const activity = (id: string, pinned = false): BloomActivity => ({ color: "blue", icon: null, id, name: id, pinned });

describe("bloomActivities", () => {
  it("puts pinned activities first, then the most used, at most nine", () => {
    const list = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"].map((id) => activity(id, id === "k" || id === "j"));
    const used = new Map([["c", 600], ["a", 60], ["j", 5]]);
    const ranked = bloomActivities(list, used).map((item) => item.id);
    expect(ranked).toEqual(["j", "k", "c", "a", "b", "d", "e", "f", "g"]);
  });
});

describe("bloomSpots", () => {
  it("fans three activities on the inner arc and six on the outer one, above and left of the orb", () => {
    const spots = bloomSpots(["a", "b", "c", "d", "e", "f", "g", "h", "i"].map((id) => activity(id)));
    expect(spots).toHaveLength(9);
    for (const [index, spot] of spots.entries()) {
      const radius = Math.hypot(spot.dx, spot.dy);
      expect(radius).toBeCloseTo(index < 3 ? PLAY_ORB.inner.radius : PLAY_ORB.outer.radius);
      expect(spot.dx).toBeLessThanOrEqual(0.0001);
      expect(spot.dy).toBeLessThanOrEqual(0.0001);
    }
    // The first inner bubble sits nearly straight above the orb, the last nearly level to its left.
    expect(spots[0].dy).toBeLessThan(-100);
    expect(spots[2].dx).toBeLessThan(-100);
  });
});

describe("bloomHit", () => {
  it("finds the nearest bubble within reach of the finger", () => {
    const spots = [{ dx: 0, dy: -112 }, { dx: -112, dy: 0 }];
    expect(bloomHit(spots, 5, -100)).toBe(0);
    expect(bloomHit(spots, -100, 10)).toBe(1);
    expect(bloomHit(spots, -60, -60)).toBe(-1);
  });
});
