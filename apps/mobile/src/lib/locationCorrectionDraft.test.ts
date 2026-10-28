import { describe, expect, it } from "vitest";
import type { TimelinePlace, TimelineTrip } from "@dayframe/shared";
import {
  canSayDidntLeave, canSayNotHere, correctable, didntLeave, legCorrection, notATrip, notHere, placeCorrections, timesProblem, tripCorrections
} from "./locationCorrectionDraft";

// Location v4 step 12: synthetic ids, names and times only.
const at = (minutes: number) => Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000;
const iso = (minutes: number) => new Date(at(minutes)).toISOString();
const SAVED = "6f000000-0000-4000-8000-000000000001";
const place: TimelinePlace = {
  kind: "place", id: "seg-a", status: "finalised", startedAt: iso(0), stoppedAt: iso(60), placeId: null, learnedPlaceId: null, name: null,
  role: null, matchKind: "unknown", confidence: "low", blockIds: []
};
const trip: TimelineTrip = {
  kind: "trip", id: "trip-1", status: "finalised", startedAt: iso(60), stoppedAt: iso(100), fromId: "seg-a", toId: "seg-b", mode: "automotive",
  legs: [
    { startedAt: iso(60), stoppedAt: iso(70), mode: "walking", confidence: "sure", distanceMeters: 700 },
    { startedAt: iso(70), stoppedAt: iso(100), mode: "automotive", confidence: "unsure", distanceMeters: 9000 }
  ], stopIds: [], distanceMeters: 9700, confidence: "medium", reason: null, blockIds: []
};
const options = [{ id: SAVED, name: "Exampleton Library", role: null }];
const same = { startMs: at(0), stopMs: at(60) };

describe("what a correction sheet sends on Done (location v4 step 12)", () => {
  it("sends nothing when nothing changed, and only what did otherwise, place before times", () => {
    expect(placeCorrections(place, { choice: { kind: "keep" }, times: same }, options)).toEqual([]);
    expect(placeCorrections(place, { choice: { kind: "saved", id: SAVED }, times: { startMs: at(5), stopMs: at(55) } }, options)).toEqual([
      { request: { kind: "place", subject: "place", itemId: "seg-a", placeId: SAVED, learnedPlaceId: null }, preview: { name: "Exampleton Library", role: null } },
      { request: { kind: "times", subject: "place", itemId: "seg-a", startedAt: iso(5), stoppedAt: iso(55) } }
    ]);
  });

  it("leaves a named place unknown, and never re-sends the place it already is", () => {
    const named = { ...place, placeId: SAVED, name: "Exampleton Library", matchKind: "saved" as const };
    expect(placeCorrections(named, { choice: { kind: "saved", id: SAVED }, times: same }, options)).toEqual([]);
    expect(placeCorrections(named, { choice: { kind: "unknown" }, times: same }, options)).toEqual([
      { request: { kind: "place", subject: "place", itemId: "seg-a", placeId: null, learnedPlaceId: null }, preview: { name: null } }
    ]);
    expect(placeCorrections(place, { choice: { kind: "unknown" }, times: same }, options)).toEqual([]);
  });

  it("says why times can't be saved: an end before the start, or times that miss the item", () => {
    expect(timesProblem(place, { startMs: at(30), stopMs: at(30) })).toBe("The end must be after the start.");
    expect(timesProblem(place, { startMs: at(70), stopMs: at(90) })).toBe("Keep some of the time it was.");
    expect(timesProblem(place, { startMs: at(-10), stopMs: at(10) })).toBeNull();
    expect(placeCorrections(place, { choice: { kind: "keep" }, times: { startMs: at(70), stopMs: at(90) } }, options)).toEqual([]);
  });

  it("offers a place's or trip's place, times and existence only with no block; a leg's mode on any trip", () => {
    const logged = { ...trip, blockIds: ["entry-1"] };
    expect(correctable(logged)).toBe(false);
    expect(tripCorrections(logged, { times: { startMs: at(62), stopMs: at(100) } })).toEqual([]);
    expect(notATrip(logged)).toBeNull();
    expect(placeCorrections({ ...place, blockIds: ["entry-2"] }, { choice: { kind: "saved", id: SAVED }, times: same }, options)).toEqual([]);
    expect(legCorrection(logged, 1, "bus")).toEqual({ request: { kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: iso(70), legStoppedAt: iso(100), mode: "bus" } });
    expect(legCorrection(trip, 1, "automotive")).toBeNull();
    expect(tripCorrections(trip, { times: { startMs: at(62), stopMs: at(100) } })).toEqual([
      { request: { kind: "times", subject: "trip", itemId: "trip-1", startedAt: iso(62), stoppedAt: iso(100) } }
    ]);
    expect(notATrip(trip)).toEqual({ request: { kind: "delete", subject: "trip", itemId: "trip-1" } });
  });

  // Step 12 part 4: synthetic ids and times.
  it("offers I wasn't here only between two trips with no block, and I didn't leave only between visits to one place", () => {
    const iso = (minutes: number) => new Date(Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000).toISOString();
    const SAVED = "6f000000-0000-4000-8000-000000000009";
    const stay = (id: string, from: number, to: number | null, placeId: string | null = null): TimelinePlace => ({
      kind: "place", id, status: "finalised", startedAt: iso(from), stoppedAt: to == null ? null : iso(to), placeId, learnedPlaceId: null,
      name: null, role: null, matchKind: placeId ? "saved" : "unknown", confidence: "low", blockIds: []
    });
    const hop = (id: string, fromId: string, toId: string): TimelineTrip => ({
      kind: "trip", id, status: "finalised", startedAt: iso(0), stoppedAt: iso(1), fromId, toId, mode: null, legs: [], stopIds: [],
      distanceMeters: null, confidence: "low", reason: null, blockIds: []
    });
    const a = stay("a", 0, 10, SAVED);
    const x = stay("x", 20, 30);
    const b = stay("b", 40, 50, SAVED);
    const items = [a, hop("t1", "a", "x"), x, hop("t2", "x", "b"), b, hop("t3", "b", "c"), stay("c", 60, null, SAVED)];
    expect(canSayNotHere(x, items)).toBe(true);
    expect(canSayNotHere(a, items)).toBe(false);
    expect(canSayNotHere({ ...x, stoppedAt: null }, items)).toBe(false);
    expect(canSayNotHere(x, items.map((item) => item.id === "t2" ? { ...item, blockIds: ["e"] } : item))).toBe(false);
    expect(notHere(x)).toEqual({ request: { kind: "delete", subject: "place", itemId: "x" } });
    const t3 = items[5] as TimelineTrip;
    expect(canSayDidntLeave(t3, items)).toBe(true);
    expect(canSayDidntLeave(items[1] as TimelineTrip, items)).toBe(false);
    expect(canSayDidntLeave(t3, items.map((item) => item.id === "c" ? { ...item, blockIds: ["e"] } : item))).toBe(false);
    expect(didntLeave(t3)).toEqual({ request: { kind: "merge", subject: "trip", itemId: "t3" } });
  });
});

