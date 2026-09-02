import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_LOCATION_BOUNDARY_TOLERANCE_MS as tolerance,
  LOCATION_ENGINE_V2_CONFIG,
  assessAutomaticLocation,
  assessAutomaticLocationBoundaries,
  assessAutomaticOverlap,
  classifyAutomaticActivity,
  matchLocationToPlaces,
  locationAcceptanceFixture,
  runLocationEngine,
  type AutomaticOverlapEntry,
  type CommuteSegment,
  type StaySegment
} from "../src/location";

const instant = (ms: number) => new Date(Date.parse("2026-08-29T23:00:00Z") + ms).toISOString();
const stay: StaySegment = {
  kind: "stay", clientSegmentId: "stay", algorithmVersion: "location-v2.0", status: "finalised",
  startedAt: instant(0), stoppedAt: instant(3_600_000), startLowerBoundAt: instant(0),
  startUpperBoundAt: instant(0), stopLowerBoundAt: instant(3_600_000), stopUpperBoundAt: instant(3_600_000),
  placeId: "saved-a", placeMatchKind: "saved", candidatePlaceIds: [], sampleCount: 4,
  continuityStatus: "continuous", confidence: "medium_high", evidenceIds: ["a", "b"]
};
const commute: CommuteSegment = {
  ...stay, kind: "commute", stoppedAt: stay.stoppedAt!, fromStaySegmentId: "a", toStaySegmentId: "b",
  fromPlaceId: "saved-a", toPlaceId: "saved-b", routeSampleCount: 3, gapDurationSeconds: 3_600,
  maximumObservationGapSeconds: 300, qualificationReason: "significant_endpoint_displacement"
};

describe("automatic boundary policy", () => {
  it.each([0, tolerance - 1, tolerance])("accepts independent widths of %i ms without changing estimates", (width) => {
    const segment = { ...stay, startLowerBoundAt: instant(-width), stopUpperBoundAt: instant(3_600_000 + width) };
    expect(assessAutomaticLocationBoundaries(segment)).toEqual({ eligible: true, startUncertaintyMs: width, stopUncertaintyMs: width, reason: "within_tolerance" });
    expect(segment.startedAt).toBe(stay.startedAt);
    expect(segment.stoppedAt).toBe(stay.stoppedAt);
  });
  it.each([
    [{ startLowerBoundAt: instant(-tolerance - 1) }, "start_exceeds_tolerance"],
    [{ stopUpperBoundAt: instant(3_600_000 + tolerance + 1) }, "stop_exceeds_tolerance"],
    [{ startLowerBoundAt: null }, "missing_bounds"],
    [{ stopUpperBoundAt: undefined }, "missing_bounds"],
    [{ startLowerBoundAt: "bad" }, "invalid_bounds"],
    [{ startLowerBoundAt: instant(1) }, "invalid_bounds"],
    [{ stoppedAt: instant(3_600_001) }, "invalid_bounds"],
    [{ stoppedAt: instant(0) }, "invalid_bounds"]
  ] as const)("fails closed for %j", (patch, reason) => {
    expect(assessAutomaticLocationBoundaries({ ...stay, ...patch })).toMatchObject({ eligible: false, reason });
  });
  it("uses instants through repeated DST hours", () => {
    expect(assessAutomaticLocationBoundaries({
      startedAt: "2026-10-25T01:58:00+01:00", stoppedAt: "2026-10-25T01:02:00+00:00",
      startLowerBoundAt: "2026-10-25T01:55:00+01:00", startUpperBoundAt: "2026-10-25T01:00:00+00:00",
      stopLowerBoundAt: "2026-10-25T01:00:00+00:00", stopUpperBoundAt: "2026-10-25T01:05:00+00:00"
    })).toMatchObject({ eligible: true, startUncertaintyMs: tolerance, stopUncertaintyMs: tolerance });
  });
});

describe("automatic confidence and route policy", () => {
  it.each(["continuous", "supported_by_visit", "broken_by_other_place", "uncertain_gap"] as const)("accepts bounded %s stays", (continuityStatus) => {
    expect(assessAutomaticLocation("v2_enabled", { ...stay, continuityStatus })).toMatchObject({ action: "auto_confirm", confidenceTier: "standard" });
  });
  it.each(["low", "medium"] as const)("rejects %s stays", (confidence) => {
    expect(assessAutomaticLocation("v2_enabled", { ...stay, confidence })).toMatchObject({ action: "review", reason: "insufficient_confidence" });
  });
  it.each(["v1", "v2_shadow", "v2_review"] as const)("keeps %s gated", (mode) => {
    expect(assessAutomaticLocation(mode, stay)).toMatchObject({ action: "review", reason: "review_mode" });
  });
  it("keeps manual corrections and unknown places out", () => {
    expect(assessAutomaticLocation("v2_enabled", { ...stay, continuityStatus: "manual" }).action).toBe("review");
    expect(assessAutomaticLocation("v2_enabled", { ...stay, placeMatchKind: "unknown" }).action).toBe("review");
  });
  it.each(["medium_high", "high"] as const)("accepts standard %s commute", (confidence) => {
    expect(assessAutomaticLocation("v2_enabled", { ...commute, confidence })).toMatchObject({ action: "auto_confirm", confidenceTier: "standard" });
  });
  it.each(["significant_endpoint_displacement", "significant_route_distance"] as const)("accepts medium saved route %s", (qualificationReason) => {
    expect(assessAutomaticLocation("v2_enabled", { ...commute, confidence: "medium", qualificationReason, continuityStatus: "uncertain_gap" })).toMatchObject({ action: "auto_confirm", confidenceTier: "medium_saved_route" });
  });
  it.each([
    { routeSampleCount: 2 }, { fromPlaceId: null }, { toPlaceId: "saved-a" },
    { status: "closed" }, { qualificationReason: "endpoint_only_significant_distance" },
    { qualificationReason: "same_place_meaningful_round_trip" },
    { maximumObservationGapSeconds: undefined },
    { maximumObservationGapSeconds: LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs / 1000 + 1 },
    { stopUpperBoundAt: null }
  ])("rejects unsafe medium route %j", (patch) => {
    expect(assessAutomaticLocation("v2_enabled", { ...commute, confidence: "medium", ...patch } as CommuteSegment).action).toBe("review");
  });
});

const entry = (source: string, eventType: string | null, overlap: number, id = "entry"): AutomaticOverlapEntry => ({
  id, source, eventType, startedAt: instant(3_600_000 - overlap), stoppedAt: instant(7_200_000), placeId: "other-place"
});
const candidate = { kind: "location_stay" as const, startedAt: stay.startedAt, stoppedAt: stay.stoppedAt!, placeId: stay.placeId };

describe("automatic activity overlaps", () => {
  const classes = [entry("manual_app", "timer_start", 1_800_000), entry("health_sleep", "health_sleep_import", 1_800_000),
    entry("location_learning", "geofence_exit", 1_800_000), entry("location_learning", "commute_detected", 1_800_000)];
  it.each(classes)("allows Health coexistence with $source / $eventType", (existing) => {
    expect(assessAutomaticOverlap({ ...candidate, kind: "health" }, [existing])).toMatchObject({ allowed: true, reason: "health_overlap_allowed" });
  });
  it.each(classes.slice(0, 2))("allows stays with $source", (existing) => {
    expect(assessAutomaticOverlap(candidate, [existing]).allowed).toBe(true);
  });
  it.each([0, tolerance - 1, tolerance, tolerance + 1])("applies single-entry threshold at %i", (overlap) => {
    for (const existing of classes) {
      const row = { ...existing, startedAt: instant(3_600_000 - overlap) };
      expect(assessAutomaticOverlap({ ...candidate, kind: "location_commute" }, [row]).allowed).toBe(overlap <= tolerance);
    }
    for (const existing of classes.slice(2)) {
      expect(assessAutomaticOverlap(candidate, [{ ...existing, startedAt: instant(3_600_000 - overlap) }]).allowed).toBe(overlap <= tolerance);
    }
  });
  it("does not sum concurrent overlaps, and clamps running entries to the candidate", () => {
    const rows = [entry("manual_app", "timer_start", tolerance, "a"), entry("manual_app", "manual_entry", tolerance, "b")];
    expect(assessAutomaticOverlap({ ...candidate, kind: "location_commute" }, rows)).toMatchObject({ allowed: true, maximumOverlapMs: tolerance });
    expect(assessAutomaticOverlap({ ...candidate, kind: "location_commute" }, [{ ...rows[0], stoppedAt: null }])).toMatchObject({ allowed: true, maximumOverlapMs: tolerance });
  });
  it("excludes self and chooses a stable blocker independently of input order", () => {
    const rows = [entry("manual_app", "timer_start", tolerance + 1, "b"), entry("manual_app", "timer_start", tolerance + 1, "a")];
    const assess = (values: AutomaticOverlapEntry[]) => assessAutomaticOverlap({ ...candidate, kind: "location_commute" }, values);
    expect(assess(rows)).toEqual(assess([...rows].reverse()));
    expect(assess(rows).blockingEntryId).toBe("a");
    expect(assessAutomaticOverlap({ ...candidate, kind: "location_commute", clientEventId: "self" }, [{ ...rows[0], clientEventId: "self" }]).maximumOverlapMs).toBe(0);
  });
  it("never uses a manual entry's place or title as location provenance", () => {
    expect(classifyAutomaticActivity(entry("manual_app", "manual_entry", 10))).toBe("manual_or_other");
  });
  it.each(["geofence_specific", "geofence_broad", "ha_geofence"])("recognises legacy %s stays as conflicting location activity", (source) => {
    const legacy = entry(source, "geofence_exit", tolerance + 1);
    expect(classifyAutomaticActivity(legacy)).toBe("location_stay");
    expect(assessAutomaticOverlap(candidate, [legacy])).toMatchObject({ allowed: false, reason: "location_stay_conflict" });
  });
});

describe("deterministic saved-place ranking", () => {
  const point = { latitude: 51.5, longitude: -0.1, horizontalAccuracyMeters: 15 };
  const place = (id: string, patch = {}) => ({ id, name: id, ...point, radiusMeters: 100, ...patch });
  const choose = (places: ReturnType<typeof place>[], patch = {}) => matchLocationToPlaces({ ...point, ...patch }, places, [], LOCATION_ENGINE_V2_CONFIG);
  it("retains alternate saved candidates with stable ties across input orders", () => {
    const places = [place("c"), place("b"), place("a")];
    expect(choose(places)).toEqual(choose([...places].reverse()));
    expect(choose(places)).toMatchObject({ kind: "saved", placeId: "a" });
    expect(choose(places).candidates.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });
  it("uses valid hints, active continuity, correction priority and distance in order", () => {
    const places = [place("a"), place("b", { priority: 10 }), place("outside", { latitude: 52 })];
    expect(choose(places).placeId).toBe("b");
    expect(choose(places, { savedPlaceIdHint: "a" }).placeId).toBe("a");
    expect(choose(places, { activePlaceId: "a" }).placeId).toBe("a");
    expect(choose(places, { savedPlaceIdHint: "outside", activePlaceId: "outside" }).placeId).toBe("b");
    expect(choose([place("a"), place("b", { latitude: 51.5007, priority: 100 })]).placeId).toBe("a");
    expect(choose([place("a"), place("b", { correctionScore: 20 })]).placeId).toBe("b");
  });
  it("retains saved preference over an equally ranked learned candidate", () => {
    expect(matchLocationToPlaces(point, [place("z-saved")], [{ ...place("a-learned"), accepted: true }], LOCATION_ENGINE_V2_CONFIG).placeId).toBe("z-saved");
  });
});

it("engine output retains complete bounds, actual commute gaps and replay determinism", () => {
  const fixture = locationAcceptanceFixture();
  const result = runLocationEngine(fixture);
  expect(runLocationEngine({ ...fixture, evidence: [...fixture.evidence].reverse() })).toEqual(result);
  for (const segment of result.segmentUpserts.filter((value) => value.status === "finalised")) {
    expect([segment.startLowerBoundAt, segment.startUpperBoundAt, segment.stopLowerBoundAt, segment.stopUpperBoundAt].every(Boolean)).toBe(true);
    if (segment.kind !== "commute") continue;
    const times = [Date.parse(segment.startedAt), ...fixture.evidence.filter((e) => segment.evidenceIds.includes(e.clientEvidenceId)).map((e) => Date.parse(e.occurredAt)), Date.parse(segment.stoppedAt)].sort((a, b) => a - b);
    expect(segment.maximumObservationGapSeconds).toBe(Math.round(Math.max(...times.slice(1).map((time, index) => time - times[index])) / 1000));
    expect(segment.gapDurationSeconds).toBe(Math.round((Date.parse(segment.stoppedAt) - Date.parse(segment.startedAt)) / 1000));
  }
});
