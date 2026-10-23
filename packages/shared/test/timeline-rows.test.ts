import { describe, expect, it } from "vitest";
import type { LocationTimeline, TimelinePlace, TimelineTrip } from "../src/location/timeline";
import { hasLocationPlaces, legDetail, legModeLabel, locationListRows, tripsByBlockId, uncoveredSeconds } from "../src/location/timelineRows";

const at = (minutes: number) => new Date(Date.parse("2026-10-22T00:00:00.000Z") + minutes * 60_000).toISOString();
const ms = (minutes: number) => Date.parse(at(minutes));
const place = (id: string, start: number, stop: number | null, patch: Partial<TimelinePlace> = {}): TimelinePlace => ({
  kind: "place", id, status: "finalised", startedAt: at(start), stoppedAt: stop == null ? null : at(stop), placeId: null,
  learnedPlaceId: null, name: null, role: null, matchKind: "unknown", confidence: "medium", blockIds: [], ...patch
});
const trip: TimelineTrip = { kind: "trip", id: "trip-1", status: "finalised", startedAt: at(470), stoppedAt: at(520), fromId: "home",
  toId: "unknown", mode: "automotive", stopIds: [], distanceMeters: 14_200, confidence: "medium", reason: null, blockIds: ["block-trip"],
  legs: [{ startedAt: at(470), stoppedAt: at(480), mode: "walking", confidence: "sure", distanceMeters: 650 },
    { startedAt: at(482), stoppedAt: at(511), mode: "underground", confidence: "unsure", runnerUp: "train", unobserved: true, distanceMeters: 12_800 }] };
const timeline = (items: LocationTimeline["items"], openTrip: LocationTimeline["openTrip"] = null): LocationTimeline => ({
  date: "2026-10-22", timeZone: "UTC", dayStart: at(0), dayEnd: at(1_440), items, openTrip, gaps: []
});

describe("Calendar › List location rows (location v4 steps 9–10)", () => {
  it("counts the time no block covers", () => {
    expect(uncoveredSeconds(ms(0), ms(60), [{ startedAt: at(10), stoppedAt: at(20) }, { startedAt: at(15), stoppedAt: at(30) }], ms(100))).toBe(40 * 60);
    expect(uncoveredSeconds(ms(0), ms(60), [{ startedAt: at(50), stoppedAt: null }], ms(55))).toBe(55 * 60);
  });

  it("shows an unknown place not in a block for ten minutes, newest first, and Home only with Show every place", () => {
    const day = timeline([
      place("home", -120, 470, { placeId: "p-home", name: "Home", role: "home", matchKind: "saved" }),
      trip,
      place("unknown", 520, 760),
      place("brief", 800, 808),
      place("logged", 900, 960)
    ]);
    const blocks = [{ startedAt: at(470), stoppedAt: at(520) }, { startedAt: at(900), stoppedAt: at(960) }, { startedAt: at(530), stoppedAt: at(700) }];
    const rows = locationListRows(day, blocks, { nowMs: ms(1_000), showAll: false });
    expect(rows.map((row) => [row.kind, row.key])).toEqual([["place", "place-unknown"]]);
    expect(rows[0]).toMatchObject({ unloggedSeconds: 70 * 60, faint: false, fromMs: ms(520), spanEndMs: ms(760) });
    const all = locationListRows(day, blocks, { nowMs: ms(1_000), showAll: true });
    expect(all.map((row) => row.kind === "place" ? [row.place.id, row.faint] : row.kind)).toEqual([
      ["logged", true], ["brief", true], ["unknown", false], ["home", true]
    ]);
    // Home's stay began the evening before: the row counts only today's part.
    expect(all.at(-1)).toMatchObject({ fromMs: ms(0) });
  });

  it("adds the journey in progress, named from its origin, and never shows ignored or still-open places as not logged", () => {
    const day = timeline([place("office", 400, 600, { name: "Office", placeId: "p-office", matchKind: "saved" }),
      place("ignored", 610, 700, { status: "ignored" }), place("here", 720, null)],
    { kind: "open_trip", fromId: "office", startedAt: at(600), lastObservedAt: at(640), mode: "walking", legs: [] });
    const rows = locationListRows(day, [], { nowMs: ms(800), showAll: false });
    expect(rows.map((row) => row.key)).toEqual(["open-trip"]);
    expect(rows[0]).toMatchObject({ fromName: "Office" });
    expect(locationListRows(null, [], { nowMs: 0, showAll: true })).toEqual([]);
  });

  it("finds a trip's legs by its block and words legs as the mock-up does", () => {
    expect(tripsByBlockId(timeline([trip])).get("block-trip")).toMatchObject({ id: "trip-1", route: "Unknown place → Unknown place" });
    expect(tripsByBlockId(timeline([place("home", 0, 470, { name: "Home", matchKind: "saved" }), trip])).get("block-trip")?.route)
      .toBe("Home → Unknown place");
    expect(tripsByBlockId(timeline([{ ...trip, legs: [] }])).size).toBe(0);
    expect(hasLocationPlaces(timeline([trip]))).toBe(false);
    expect(legModeLabel(trip.legs[1])).toBe("Underground or train?");
    expect(legModeLabel(trip.legs[0])).toBe("Walk");
    expect(legDetail(trip.legs[1])).toBe("13 km · no GPS underground, guessed from the gap");
    expect(legDetail({ ...trip.legs[0], confidence: "likely" })).toBe("0.7 km · likely");
  });
});
