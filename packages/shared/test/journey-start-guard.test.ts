import { describe, expect, it } from "vitest";
import { deriveCommutes } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG as config } from "../src/location/config";
import type { ClassifiedEvidence, LocationEvidence, StaySegment } from "../src/location/types";

// Location v4 Fix B, without Fix A's stay-keeping in front of it: synthetic equatorial geometry in
// metres around a made-up origin (an unknown stay's own completed Visit centre), synthetic identities.
const at = (minutes: number) => new Date(Date.UTC(2026, 0, 19, 8) + Math.round(minutes * 60_000)).toISOString();
const latitude = (northMetres: number) => northMetres / 110_574;
const longitude = (eastMetres: number) => eastMetres / 111_320;

function stay(id: string, startedAt: number, stoppedAt: number | null, east: number, evidenceIds: string[] = []): StaySegment {
  return { kind: "stay", clientSegmentId: id, algorithmVersion: config.algorithmVersion,
    status: stoppedAt == null ? "open" : "finalised", startedAt: at(startedAt), stoppedAt: stoppedAt == null ? null : at(stoppedAt),
    placeId: null, placeMatchKind: "unknown", candidatePlaceIds: [], centreLatitude: latitude(0), centreLongitude: longitude(east),
    sampleCount: 5, continuityStatus: "continuous", confidence: "medium", evidenceIds };
}

function reading(id: string, minutes: number, north: number, east: number, patch: Partial<LocationEvidence> = {}): ClassifiedEvidence {
  return { evidence: { clientEvidenceId: id, deviceId: "device-b", algorithmVersion: config.algorithmVersion,
    kind: "standard_location", occurredAt: at(minutes), sourceTimestamp: at(minutes), receivedAt: at(400), timeZone: "UTC",
    latitude: latitude(north), longitude: longitude(east), horizontalAccuracyMeters: 12, speedMetersPerSecond: 0,
    isSimulated: false, ...patch }, impliedSpeedMetersPerSecond: null, match: null };
}

const visit = (id: string, minutes: number, endsAt: number | null, accuracy: number) =>
  reading(id, minutes, 0, 0, { kind: "visit", endedAt: endsAt == null ? null : at(endsAt), horizontalAccuracyMeters: accuracy,
    speedMetersPerSecond: null, metadata: endsAt == null ? { visitDepartureOpen: true } : undefined });

const ORIGIN_PLACE_ID = "10000000-0000-4000-8000-0000000000b1";

type Shape = {
  /** The origin's completed Visit departure in minutes (default 240); null leaves only the arrival callback. */
  visitEndsAt?: number | null;
  /** How far north of the Visit centre the still readings at minutes 90, 180 and 220 lie (default 100). */
  stillNorth?: number;
  /** Leave the still readings out: the first reading after the silence is already moving. */
  noStillReadings?: boolean;
  /** A reading every two minutes from the origin's end, so the journey is continuous. */
  continuous?: boolean;
  /** The origin is a saved place whose geofence exit fires at this minute. */
  exitAt?: number;
  /** With `exitAt`: the exit is half of a registration snapshot (an entry 2.4 s later). */
  snapshot?: boolean;
  /** A moving reading exactly at the origin stay's end (the departure itself). */
  departureMoving?: boolean;
  /** A newer completed Visit (minutes 30–100) attached to the origin with no reported accuracy. */
  newerVisitWithoutAccuracy?: boolean;
};

function journey(shape: Shape = {}) {
  const visitEndsAt = shape.visitEndsAt === undefined ? 240 : shape.visitEndsAt;
  const stillNorth = shape.stillNorth ?? 100;
  const own = [visit("origin-arrival", 0, null, 16), ...(visitEndsAt == null ? [] : [visit("origin-visit", 0, visitEndsAt, 104)]),
    ...(shape.newerVisitWithoutAccuracy ? [{ ...visit("origin-newer-visit", 30, 100, 0),
      evidence: { ...visit("origin-newer-visit", 30, 100, 0).evidence, horizontalAccuracyMeters: null } }] : [])];
  const fixes = [reading("origin-a", 5, -40, 0), reading("origin-b", 50, -30, 10)];
  // The origin stay ended early (a stray reading split it): the stretch to minute 240 is not its own.
  const callback = (id: string, minutes: number, kind: "geofence_exit" | "geofence_enter") => reading(id, minutes, 0, 0, { kind,
    latitude: null, longitude: null, horizontalAccuracyMeters: null, speedMetersPerSecond: null, savedPlaceId: ORIGIN_PLACE_ID });
  const exit = shape.exitAt == null ? [] : [callback("origin-exit", shape.exitAt, "geofence_exit"),
    ...(shape.snapshot ? [callback("origin-snapshot-enter", shape.exitAt + 0.04, "geofence_enter")] : [])];
  const from = { ...stay("origin", 0, 60, 0, [...own, ...fixes, ...exit].map(({ evidence }) => evidence.clientEvidenceId)),
    ...(shape.exitAt == null ? {} : { placeId: ORIGIN_PLACE_ID, placeMatchKind: "saved" as const }) };
  const to = stay("destination", 262, null, 1_500, ["destination-a"]);
  const still = shape.noStillReadings || shape.continuous ? [] : [
    reading("still-1", 90, stillNorth, 0), reading("still-2", 180, stillNorth, 10), reading("still-3", 220, stillNorth, -10)
  ];
  const route = shape.continuous
    ? Array.from({ length: 100 }, (_, index) => reading(`walk-${index}`, 62 + index * 2, 0, 10 + index * 14,
      { speedMetersPerSecond: index < 10 ? 0.3 : 1.6 }))
    : [reading("walk-1", 242, 150, 150, { speedMetersPerSecond: 1.7, horizontalAccuracyMeters: 9 }),
      reading("walk-2", 248, 100, 600, { speedMetersPerSecond: 1.5 }),
      reading("walk-3", 255, 50, 1_100, { speedMetersPerSecond: 1.4 })];
  const departure = shape.departureMoving ? [reading("departure", 60, 0, 20, { speedMetersPerSecond: 8, horizontalAccuracyMeters: 8 })] : [];
  const evidence = [...own, ...fixes, ...exit, ...departure, ...still, ...route, reading("destination-a", 262, 0, 1_500)]
    .sort((a, b) => Date.parse(a.evidence.occurredAt) - Date.parse(b.evidence.occurredAt));
  const stays = shape.continuous ? [from, stay("destination", 264, null, 1_500, ["destination-a"])] : [from, to];
  if (shape.continuous) evidence.find(({ evidence: e }) => e.clientEvidenceId === "destination-a")!.evidence.occurredAt = at(264);
  return deriveCommutes(stays, evidence, config, at(400));
}

describe("journey start guard (location v4 Fix B)", () => {
  it("never claims time the origin's own completed Visit covers", () => {
    const [move] = journey();
    expect(move).toMatchObject({ startedAt: at(240), fromStaySegmentId: "origin", toStaySegmentId: "destination" });
    expect(move.evidenceIds).not.toEqual(expect.arrayContaining(["still-1", "still-2", "still-3"]));
  });

  it("starts at the last reading before movement when a silence over the continuity limit comes first", () => {
    // No completed Visit: only the arrival callback, which covers nothing.
    const [move] = journey({ visitEndsAt: null });
    expect(move.startedAt).toBe(at(220));
    expect(move.evidenceIds).toEqual(["walk-1", "walk-2", "walk-3"]);
  });

  it("does not let a Visit the device was seen leaving hold the start; the silence rule still applies", () => {
    // The still readings lie 400 m from the Visit centre, beyond its 104 m radius plus their 12 m.
    const [move] = journey({ stillNorth: 400 });
    expect(move.startedAt).toBe(at(220));
  });

  it("needs a reading inside the Visit after the stay ended: a Visit alone never delays a departure", () => {
    const [move] = journey({ noStillReadings: true });
    expect(move.startedAt).toBe(at(60));
  });

  it("lets the origin's own geofence exit before the Visit's departure overrule it; the silence rule still applies", () => {
    const [move] = journey({ exitAt: 61 });
    expect(move.startedAt).toBe(at(220));
  });

  it("keeps the start when the first reading after the silence is already moving", () => {
    const [move] = journey({ visitEndsAt: null, noStillReadings: true });
    expect(move.startedAt).toBe(at(60));
  });

  it("counts movement at the start itself: the departure reading keeps the start", () => {
    const [move] = journey({ visitEndsAt: null, departureMoving: true });
    expect(move.startedAt).toBe(at(60));
  });

  it("picks the covering Visit as Fix A does: a newer Visit without a radius covers nothing", () => {
    const [move] = journey({ newerVisitWithoutAccuracy: true });
    expect(move.startedAt).toBe(at(220));
  });

  it("never lets a registration snapshot's exit overrule the Visit", () => {
    const [move] = journey({ exitAt: 61, snapshot: true });
    expect(move.startedAt).toBe(at(240));
  });

  it("leaves a continuous journey unchanged, still readings before movement included", () => {
    const [move] = journey({ visitEndsAt: null, continuous: true });
    expect(move.startedAt).toBe(at(60));
    expect(move.continuityStatus).toBe("continuous");
  });
});
