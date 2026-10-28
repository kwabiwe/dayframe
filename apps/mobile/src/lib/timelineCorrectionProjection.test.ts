import { describe, expect, it } from "vitest";
import type { LocationTimeline, TimelineCorrectionRequest, TimelinePlace, TimelineTrip } from "@dayframe/shared";
import { correctionsToShow, projectTimelineCorrections } from "./timelineCorrectionProjection";
import type { PendingTimelineCorrection } from "./timelineCorrectionOutbox";

// Location v4 step 12: synthetic ids, names and times only.
const at = (minutes: number) => new Date(Date.parse("2026-10-27T08:00:00.000Z") + minutes * 60_000).toISOString();
const PLACE_ID = "6f000000-0000-4000-8000-000000000001";
const place = (id: string, start: number, stop: number): TimelinePlace => ({
  kind: "place", id, status: "finalised", startedAt: at(start), stoppedAt: at(stop), placeId: null, learnedPlaceId: null, name: null,
  role: null, matchKind: "unknown", confidence: "low", blockIds: []
});
const trip: TimelineTrip = {
  kind: "trip", id: "trip-1", status: "finalised", startedAt: at(60), stoppedAt: at(100), fromId: "seg-a", toId: "seg-b", mode: "automotive",
  legs: [
    { startedAt: at(60), stoppedAt: at(70), mode: "walking", confidence: "sure", distanceMeters: 700 },
    { startedAt: at(70), stoppedAt: at(100), mode: "automotive", confidence: "unsure", runnerUp: "bus", distanceMeters: 9000 }
  ],
  stopIds: [], distanceMeters: 9700, confidence: "medium", reason: null, blockIds: []
};
const timeline: LocationTimeline = {
  date: "2026-10-27", timeZone: "UTC", dayStart: at(-480), dayEnd: at(960),
  items: [place("seg-a", 0, 60), trip, place("seg-b", 100, 200)], openTrip: null, gaps: []
};
let n = 0;
const queued = (request: TimelineCorrectionRequest, extra: Partial<PendingTimelineCorrection> = {}): PendingTimelineCorrection => ({
  userId: "u", workspaceId: "w", clientCorrectionId: `id-${++n}`, request: { ...request, clientCorrectionId: `id-${n}` } as PendingTimelineCorrection["request"],
  createdAt: at(0), attemptCount: 0, ...extra
});

describe("the List with the corrections the phone still holds (location v4 step 12)", () => {
  it("names a place with the picked place, set by you", () => {
    const projected = projectTimelineCorrections(timeline, [
      queued({ kind: "place", subject: "place", itemId: "seg-a", placeId: PLACE_ID, learnedPlaceId: null }, { preview: { name: "Exampleton Library", role: null } })
    ])!;
    expect(projected.items[0]).toMatchObject({ placeId: PLACE_ID, name: "Exampleton Library", matchKind: "saved", setByYou: true });
    expect(projected.items[2]).toEqual(timeline.items[2]);
  });

  it("leaves a place unknown, moves times, and takes a trip that wasn't one off the List", () => {
    const named = { ...timeline, items: [{ ...place("seg-a", 0, 60), placeId: PLACE_ID, name: "Home", role: "home", matchKind: "saved" as const }, trip] };
    const projected = projectTimelineCorrections(named, [
      queued({ kind: "place", subject: "place", itemId: "seg-a", placeId: null, learnedPlaceId: null }),
      queued({ kind: "times", subject: "place", itemId: "seg-a", startedAt: at(5), stoppedAt: at(55) }),
      queued({ kind: "delete", subject: "trip", itemId: "trip-1" })
    ])!;
    expect(projected.items).toEqual([expect.objectContaining({ id: "seg-a", placeId: null, name: null, role: null, matchKind: "unknown",
      startedAt: at(5), stoppedAt: at(55), setByYou: true })]);
  });

  it("sets a leg's mode, sure and set by you, joining it with a neighbour of the same mode", () => {
    const projected = projectTimelineCorrections(timeline, [
      queued({ kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: at(70), legStoppedAt: at(100), mode: "walking" })
    ])!;
    expect((projected.items[1] as TimelineTrip).legs).toEqual([
      expect.objectContaining({ startedAt: at(60), stoppedAt: at(100), mode: "walking" })
    ]);
    const bus = projectTimelineCorrections(timeline, [
      queued({ kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: at(70), legStoppedAt: at(100), mode: "bus" })
    ])!;
    expect((bus.items[1] as TimelineTrip).legs[1]).toEqual({ startedAt: at(70), stoppedAt: at(100), mode: "bus", confidence: "sure", distanceMeters: 9000, setByYou: true });
  });

  it("sets only the leg with exactly those ends, as the server, and leaves a leg that changed meanwhile (Codex r1 on #598)", () => {
    const moved = projectTimelineCorrections(timeline, [
      queued({ kind: "leg_mode", subject: "leg", itemId: "trip-1", legStartedAt: at(60), legStoppedAt: at(80), mode: "bus" })
    ])!;
    expect(moved.items[1]).toEqual(trip);
  });

  it("names the picked place even when its preview has no name, and keeps the name with no preview (Codex r1 on #598)", () => {
    const named = { ...timeline, items: [{ ...place("seg-a", 0, 60), placeId: PLACE_ID, name: "Home", role: "home", matchKind: "saved" as const }] };
    const learned = projectTimelineCorrections(named, [queued({ kind: "place", subject: "place", itemId: "seg-a", placeId: null,
      learnedPlaceId: "6f000000-0000-4000-8000-000000000009" }, { preview: { name: null } })])!;
    expect(learned.items[0]).toMatchObject({ name: null, role: null, matchKind: "learned" });
    const kept = projectTimelineCorrections(named, [queued({ kind: "place", subject: "place", itemId: "seg-a", placeId: PLACE_ID, learnedPlaceId: null })])!;
    expect(kept.items[0]).toMatchObject({ name: "Home", role: "home" });
  });

  it("leaves a refused correction out, so its row is back as it was", () => {
    expect(projectTimelineCorrections(timeline, [
      queued({ kind: "delete", subject: "trip", itemId: "trip-1" }, { failureKind: "permanent", lastError: "This trip is already in a block." })
    ])).toBe(timeline);
    expect(projectTimelineCorrections(null, [queued({ kind: "delete", subject: "trip", itemId: "trip-1" })])).toBeNull();
  });

  it("keeps a delivered correction shown until a timeline asked for after it lands, so a trip never comes back (Codex r1 on #598)", () => {
    const delivered = { ...queued({ kind: "delete", subject: "trip", itemId: "trip-1" }), acknowledgedAt: 2_000 };
    const waiting = queued({ kind: "times", subject: "place", itemId: "seg-a", startedAt: at(5), stoppedAt: at(55) });
    expect(correctionsToShow([delivered], [waiting], 1_000)).toEqual([delivered, waiting]);
    expect(correctionsToShow([delivered], [waiting], 3_000)).toEqual([waiting]);
    expect(projectTimelineCorrections(timeline, correctionsToShow([delivered], [], 1_000))!.items.map((item) => item.id)).toEqual(["seg-a", "seg-b"]);
  });

  // Step 12 part 4.
  const home = (id: string, start: number, stop: number | null) => ({ ...place(id, start, stop ?? 0), stoppedAt: stop == null ? null : at(stop),
    placeId: PLACE_ID, name: "Home", role: "home", matchKind: "saved" as const });
  const leg = (from: number, to: number, mode: "walking" | "automotive") => ({ startedAt: at(from), stoppedAt: at(to), mode, confidence: "sure" as const, distanceMeters: 1000 });
  const hop = (id: string, from: number, to: number, fromId: string, toId: string, mode: "walking" | "automotive"): TimelineTrip =>
    ({ ...trip, id, startedAt: at(from), stoppedAt: at(to), fromId, toId, mode, legs: [leg(from, to, mode)], distanceMeters: 1000 });
  const day: LocationTimeline = { ...timeline, items: [
    home("h1", 0, 60), hop("t1", 60, 80, "h1", "x", "automotive"), place("x", 80, 95), hop("t2", 95, 120, "x", "h2", "walking"),
    home("h2", 120, 150), hop("t3", 150, 160, "h2", "h3", "walking"), home("h3", 160, 200), hop("t4", 200, 230, "h3", "y", "automotive"),
    place("y", 230, 300)
  ] };

  it("joins the trips around a place you weren't at, as the server does", () => {
    const projected = projectTimelineCorrections(day, [queued({ kind: "delete", subject: "place", itemId: "x" })])!;
    expect(projected.items.map((item) => item.id)).toEqual(["h1", "t1", "h2", "t3", "h3", "t4", "y"]);
    expect(projected.items[1]).toMatchObject({ startedAt: at(60), stoppedAt: at(120), toId: "h2", mode: null, distanceMeters: 2000,
      confidence: "low", setByYou: true });
    expect((projected.items[1] as TimelineTrip).legs.map((each) => each.mode)).toEqual(["automotive", "walking"]);
  });

  it("makes two visits to one place one stay when you didn't leave, and the trip after leaves it", () => {
    const projected = projectTimelineCorrections(day, [queued({ kind: "merge", subject: "trip", itemId: "t3" })])!;
    expect(projected.items.map((item) => item.id)).toEqual(["h1", "t1", "x", "t2", "h2", "t4", "y"]);
    expect(projected.items[4]).toMatchObject({ startedAt: at(120), stoppedAt: at(200), setByYou: true });
    expect(projected.items[5]).toMatchObject({ fromId: "h2" });
  });

  it("changes nothing for a join the server would refuse", () => {
    expect(projectTimelineCorrections(day, [queued({ kind: "delete", subject: "place", itemId: "y" })])!.items).toEqual(day.items);
    expect(projectTimelineCorrections(day, [queued({ kind: "merge", subject: "trip", itemId: "t2" })])!.items).toEqual(day.items);
  });

  // Codex r1 on #606: as the server makes them.
  it("gives the one stay its last visit's status and journey, and the joined trip no reason", () => {
    const open = { ...day, items: day.items.map((item) => item.id === "h3" ? { ...item, status: "open" } : item),
      openTrip: { kind: "open_trip", fromId: "h3", startedAt: at(200), legs: [] } } as unknown as LocationTimeline;
    const merged = projectTimelineCorrections(open, [queued({ kind: "merge", subject: "trip", itemId: "t3" })])!;
    expect(merged.items.find((item) => item.id === "h2")).toMatchObject({ status: "open" });
    expect(merged.openTrip).toMatchObject({ fromId: "h2" });
    const reasoned = { ...day, items: day.items.map((item) => item.id === "t1" ? { ...item, reason: "same_place_meaningful_round_trip" } : item) };
    const joined = projectTimelineCorrections(reasoned, [queued({ kind: "delete", subject: "place", itemId: "x" })])!;
    expect(joined.items.find((item) => item.id === "t1")).toMatchObject({ reason: null });
  });
});

