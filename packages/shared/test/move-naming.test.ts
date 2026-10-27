import { describe, expect, it } from "vitest";
import { GETTING_AROUND, moveName, stayName } from "../src/location/moveNaming";

const home = { name: "Home", role: "home" as const };
const work = { name: "Work", role: "work" as const };
const gym = { name: "Peak Gym", role: null };
const unknown = { name: null, role: null };

describe("Stays and Moves naming (PRD D19, D21; card A)", () => {
  it("calls only Home ↔ Work a Commute, in either direction, with no mode in its route", () => {
    expect(moveName({ from: home, to: work, sameEndpoint: false })).toEqual({ title: "Commute", route: "Home → Work", activity: "commute" });
    expect(moveName({ from: work, to: home, sameEndpoint: false })).toEqual({ title: "Commute", route: "Work → Home", activity: "commute" });
    expect(moveName({ from: home, to: gym, sameEndpoint: false }).title).toBe(GETTING_AROUND);
  });

  it("calls every other trip Getting around, never by a mode", () => {
    expect(GETTING_AROUND).toBe("Getting around");
    expect(moveName({ from: home, to: gym, sameEndpoint: false })).toEqual({ title: "Getting around", route: "Home → Peak Gym", activity: "travel" });
    expect(moveName({ from: gym, to: unknown, sameEndpoint: false }))
      .toEqual({ title: "Getting around", route: "Peak Gym → Unknown place", activity: "travel" });
  });

  it("names a round trip from where it started, and a Move with stops as an errand", () => {
    expect(moveName({ from: home, to: home, sameEndpoint: true }))
      .toEqual({ title: "Getting around", route: "Round trip from Home", activity: "travel" });
    expect(moveName({ from: home, to: home, sameEndpoint: true, stopCount: 1 }))
      .toEqual({ title: "Getting around", route: "Home → a stop → Home", activity: "errand" });
    expect(moveName({ from: home, to: gym, sameEndpoint: false, stopCount: 2 }).route).toBe("Home → 2 stops → Peak Gym");
    // A Home ↔ Work Move with a stop is still a Commute.
    expect(moveName({ from: home, to: work, sameEndpoint: false, stopCount: 1 }).activity).toBe("commute");
  });

  it("names a Stay by its place", () => {
    expect(stayName({ name: " Peak Gym " })).toBe("Peak Gym");
    expect(stayName({ name: null })).toBe("Unknown place");
    expect(stayName({ name: "", ambiguous: true })).toBe("Near saved places");
  });
});
