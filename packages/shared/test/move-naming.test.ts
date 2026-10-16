import { describe, expect, it } from "vitest";
import { moveModeWord, moveName, stayName } from "../src/location/moveNaming";

const home = { name: "Home", role: "home" as const };
const work = { name: "Work", role: "work" as const };
const gym = { name: "Peak Gym", role: null };
const unknown = { name: null, role: null };

describe("Stays and Moves naming (PRD D19)", () => {
  it("words each travel mode", () => {
    expect(["automotive", "walking", "running", "cycling", "bus", null].map(moveModeWord)).toEqual(["Drive", "Walk", "Run", "Cycle", null, null]);
  });

  it("calls only Home ↔ Work a Commute, in either direction and any mode", () => {
    expect(moveName({ from: home, to: work, travelMode: "automotive", sameEndpoint: false }))
      .toEqual({ title: "Commute", route: "Drive · Home → Work", activity: "commute" });
    expect(moveName({ from: work, to: home, sameEndpoint: false })).toEqual({ title: "Commute", route: "Work → Home", activity: "commute" });
    expect(moveName({ from: home, to: gym, travelMode: "automotive", sameEndpoint: false }).title).toBe("Drive");
  });

  it("names other Moves by their mode, else Trip, with Travel", () => {
    expect(moveName({ from: home, to: gym, travelMode: "walking", sameEndpoint: false }))
      .toEqual({ title: "Walk", route: "Home → Peak Gym", activity: "travel" });
    expect(moveName({ from: gym, to: unknown, sameEndpoint: false }))
      .toEqual({ title: "Trip", route: "Peak Gym → Unknown place", activity: "travel" });
  });

  it("names a round trip from where it started, and a Move with stops as an errand", () => {
    expect(moveName({ from: home, to: home, travelMode: "automotive", sameEndpoint: true }))
      .toEqual({ title: "Drive", route: "Round trip from Home", activity: "travel" });
    expect(moveName({ from: home, to: home, sameEndpoint: true, stopCount: 1 }))
      .toEqual({ title: "Trip", route: "Home → a stop → Home", activity: "errand" });
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
