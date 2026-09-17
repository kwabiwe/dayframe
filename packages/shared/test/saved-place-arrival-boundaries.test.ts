import { describe, expect, it } from "vitest";
import { assessAutomaticLocation, runLocationEngine } from "../src/location";
import { LOCATION_ENGINE_V2_CONFIG } from "../src/location/config";
import { analyseSavedPlaceArrivalEvidence } from "../src/location/savedPlaceArrivalSupport";
import type { CommuteSegment, LocationEvidence, StaySegment } from "../src/location/types";
import {
  ARRIVAL_BOUNDARY_PLACE,
  ARRIVAL_BOUNDARY_PROCESSING_AT,
  ARRIVAL_BOUNDARY_VISIT_AT,
  ARRIVAL_BOUNDARY_VISIT_END,
  savedPlaceArrivalBoundaryFixture,
  savedPlaceArrivalBoundaryPerformanceFixture
} from "../src/location/savedPlaceArrivalBoundaryFixture";

function output(options: Parameters<typeof savedPlaceArrivalBoundaryFixture>[0] = {}) {
  return runLocationEngine(savedPlaceArrivalBoundaryFixture(options));
}

function gymStay(result: ReturnType<typeof output>): StaySegment | undefined {
  const segment = result.segmentUpserts.find(
    (candidate) => candidate.kind === "stay" && candidate.placeId === ARRIVAL_BOUNDARY_PLACE.id
  );
  return segment?.kind === "stay" ? segment : undefined;
}

function inbound(result: ReturnType<typeof output>) {
  return result.segmentUpserts.find(
    (segment) => segment.kind === "commute" && segment.toPlaceId === ARRIVAL_BOUNDARY_PLACE.id
  );
}

describe("saved-place arrival boundary V1 synthetic contract", () => {
  it("recovers the full unconfirmed interval from a corroborated broad Visit", () => {
    const result = output();
    const gymStay = result.segmentUpserts.find(
      (segment) => segment.kind === "stay" && segment.placeId === ARRIVAL_BOUNDARY_PLACE.id
    );
    const commutes = result.segmentUpserts.filter((segment) => segment.kind === "commute");

    expect(gymStay).toMatchObject({
      startedAt: ARRIVAL_BOUNDARY_VISIT_AT,
      stoppedAt: ARRIVAL_BOUNDARY_VISIT_END,
      continuityStatus: "uncertain_gap",
      confidence: "medium",
      status: "finalised"
    });
    expect(gymStay?.startLowerBoundAt).toBe(ARRIVAL_BOUNDARY_VISIT_AT);
    expect(gymStay?.startUpperBoundAt).toBe("2026-09-17T11:33:30.000Z");
    expect(gymStay?.stopLowerBoundAt).toBe("2026-09-17T12:31:00.000Z");
    expect(gymStay?.stopUpperBoundAt).toBe(ARRIVAL_BOUNDARY_VISIT_END);
    expect(gymStay?.evidenceIds).toEqual(expect.arrayContaining([
      "arrival-visit",
      "arrival-geofence-enter",
      "arrival-strong-1",
      "arrival-strong-2",
      "later-strong-1",
      "later-strong-2",
      "later-strong-3"
    ]));

    const inboundCommute = commutes.find((segment) => segment.kind === "commute" && segment.toPlaceId === ARRIVAL_BOUNDARY_PLACE.id);
    expect(inboundCommute).toMatchObject({
      stoppedAt: ARRIVAL_BOUNDARY_VISIT_AT,
      confidence: "low"
    });
    expect(inboundCommute?.evidenceIds).toEqual(["route-out-1", "route-out-2", "route-out-3"]);
    expect(inboundCommute?.routeSampleCount).toBe(3);
    expect(inboundCommute?.maximumObservationGapSeconds).toBeLessThanOrEqual(LOCATION_ENGINE_V2_CONFIG.maxContinuityGapMs / 1000);
  });

  it("suppresses only the conflicting spanning commute when full support is unavailable", () => {
    const result = output({ includeVisit: false });
    const gymStays = result.segmentUpserts.filter(
      (segment) => segment.kind === "stay" && segment.placeId === ARRIVAL_BOUNDARY_PLACE.id
    );
    const inbound = result.segmentUpserts.filter(
      (segment) => segment.kind === "commute" && segment.toPlaceId === ARRIVAL_BOUNDARY_PLACE.id
    );
    const returnCommute = result.segmentUpserts.find(
      (segment) => segment.kind === "commute" && segment.fromPlaceId === ARRIVAL_BOUNDARY_PLACE.id
    );

    expect(gymStays).toHaveLength(1);
    expect(gymStays[0].startedAt).toBe("2026-09-17T12:21:00.000Z");
    expect(inbound).toEqual([]);
    expect(returnCommute).toBeDefined();
  });

  it("does not treat a single callback as a stay or arrival conflict", () => {
    const result = output({ includeVisit: false });
    const fixture = savedPlaceArrivalBoundaryFixture({ includeVisit: false, includeArrivalGeofence: false });
    fixture.evidence = fixture.evidence.filter((evidence) => !evidence.clientEvidenceId.startsWith("arrival-strong-2"));
    const singlePointResult = runLocationEngine(fixture);

    expect(result.segmentUpserts.some((segment) => segment.kind === "stay" && segment.placeId === ARRIVAL_BOUNDARY_PLACE.id && segment.startedAt === ARRIVAL_BOUNDARY_VISIT_AT)).toBe(false);
    expect(singlePointResult.segmentUpserts.filter((segment) => segment.kind === "commute" && segment.toPlaceId === ARRIVAL_BOUNDARY_PLACE.id)).toHaveLength(1);
    expect(ARRIVAL_BOUNDARY_PROCESSING_AT).toBe(fixture.processingAt);
  });
});

describe("saved-place arrival support eligibility and safety", () => {
  it("keeps the existing exact high-quality Visit path unchanged", () => {
    const stay = gymStay(output({ visitAccuracyMeters: 65 }));
    expect(stay).toMatchObject({
      startedAt: ARRIVAL_BOUNDARY_VISIT_AT,
      stoppedAt: ARRIVAL_BOUNDARY_VISIT_END,
      confidence: "medium_high",
      continuityStatus: "broken_by_other_place",
      startLowerBoundAt: ARRIVAL_BOUNDARY_VISIT_AT,
      startUpperBoundAt: ARRIVAL_BOUNDARY_VISIT_AT,
      stopLowerBoundAt: ARRIVAL_BOUNDARY_VISIT_END,
      stopUpperBoundAt: ARRIVAL_BOUNDARY_VISIT_END
    });
  });

  it.each([65.01, 200])("uses the new conservative path at %s m", (accuracy) => {
    const fixture = savedPlaceArrivalBoundaryFixture({ visitAccuracyMeters: accuracy });
    const result = runLocationEngine(fixture);
    const stay = gymStay(result);
    const analysis = analyseSavedPlaceArrivalEvidence(result.acceptedEvidence, fixture);
    expect(stay?.startedAt).toBe(ARRIVAL_BOUNDARY_VISIT_AT);
    expect(stay?.confidence).toBe("medium");
    expect(stay?.continuityStatus).toBe("uncertain_gap");
    expect(analysis.corroboratedVisits.has("arrival-visit")).toBe(true);
    expect(stay?.sampleCount).toBe(5);
    expect(stay?.centreLatitude).toBe(ARRIVAL_BOUNDARY_PLACE.latitude);
    expect(stay?.centreLongitude).toBeCloseTo(ARRIVAL_BOUNDARY_PLACE.longitude, 8);
  });

  it("does not recover an above-ceiling, null-accuracy, or invalid-departure Visit", () => {
    const variants = [
      { visitAccuracyMeters: 200.01, includeArrivalGeofence: false },
      { visitAccuracyMeters: null, includeArrivalGeofence: false },
      { visitEndedAt: "2026-09-17T11:32:50.000Z", includeArrivalGeofence: false },
      { visitEndedAt: "2026-09-17T15:01:00.000Z", includeArrivalGeofence: false }
    ] as const;
    for (const options of variants) {
      const result = output(options);
      expect(gymStay(result)?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
      expect(inbound(result)).toBeDefined();
    }
  });

  it("does not waive the minimum five-minute interval or invent a future endpoint", () => {
    const shortVisit = output({
      visitEndedAt: "2026-09-17T11:37:50.000Z",
      includeArrivalGeofence: false
    });
    expect(gymStay(shortVisit)?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const future = output({
      visitEndedAt: "2026-09-17T15:01:00.000Z",
      includeArrivalGeofence: false
    });
    expect(future.segmentUpserts.every((segment) =>
      !segment.stoppedAt || Date.parse(segment.stoppedAt) <= Date.parse(ARRIVAL_BOUNDARY_PROCESSING_AT)
    )).toBe(true);
  });

  it("requires the later five-minute cluster and supports the full path without a geofence callback", () => {
    const noGeofence = output({ includeArrivalGeofence: false });
    expect(gymStay(noGeofence)?.startedAt).toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const noLaterCluster = savedPlaceArrivalBoundaryFixture();
    noLaterCluster.evidence = noLaterCluster.evidence.filter((evidence) => !evidence.clientEvidenceId.startsWith("later-strong-"));
    expect(gymStay(runLocationEngine(noLaterCluster))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
  });

  it("keeps the dedicated arrival window and later dwell requirements exact", () => {
    const exactWindow = savedPlaceArrivalBoundaryFixture();
    exactWindow.evidence = exactWindow.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-strong-2"
        ? { ...evidence, occurredAt: new Date(Date.parse(ARRIVAL_BOUNDARY_VISIT_AT) + 300_000).toISOString() }
        : evidence
    );
    expect(analyseSavedPlaceArrivalEvidence(
      runLocationEngine(exactWindow).acceptedEvidence,
      exactWindow
    ).corroboratedVisits.has("arrival-visit")).toBe(true);

    const outsideWindow = savedPlaceArrivalBoundaryFixture();
    outsideWindow.evidence = outsideWindow.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-strong-2"
        ? { ...evidence, occurredAt: new Date(Date.parse(ARRIVAL_BOUNDARY_VISIT_AT) + 300_001).toISOString() }
        : evidence
    );
    expect(gymStay(runLocationEngine(outsideWindow))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const belowLaterDwell = savedPlaceArrivalBoundaryFixture();
    belowLaterDwell.evidence = belowLaterDwell.evidence.map((evidence) => {
      if (evidence.clientEvidenceId === "later-strong-2") {
        return { ...evidence, occurredAt: "2026-09-17T12:23:00.000Z" };
      }
      if (evidence.clientEvidenceId === "later-strong-3") {
        return { ...evidence, occurredAt: "2026-09-17T12:24:00.000Z" };
      }
      return evidence;
    });
    expect(gymStay(runLocationEngine(belowLaterDwell))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    expect(gymStay(runLocationEngine(savedPlaceArrivalBoundaryFixture({
      visitEndedAt: "2026-09-17T12:00:00.000Z"
    })))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
  });

  it("does not use open, nonfinite, missing-coordinate, duplicate-time, or state-only support", () => {
    for (const options of [{ visitEndedAt: null }, { visitAccuracyMeters: Number.NaN }]) {
      const fixture = savedPlaceArrivalBoundaryFixture(options);
      expect(gymStay(runLocationEngine(fixture))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
    }

    const missingCoordinates = savedPlaceArrivalBoundaryFixture();
    missingCoordinates.evidence = missingCoordinates.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-visit"
        ? { ...evidence, latitude: null, longitude: null }
        : evidence
    );
    expect(gymStay(runLocationEngine(missingCoordinates))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const duplicateTime = savedPlaceArrivalBoundaryFixture();
    duplicateTime.evidence = duplicateTime.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-strong-2"
        ? { ...evidence, occurredAt: "2026-09-17T11:33:30.000Z" }
        : evidence
    );
    expect(gymStay(runLocationEngine(duplicateTime))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const stateOnly = savedPlaceArrivalBoundaryFixture({ includeVisit: false });
    stateOnly.evidence = stateOnly.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-geofence-enter"
        ? { ...evidence, kind: "geofence_state", metadata: { geofenceState: "inside" } }
        : evidence
    );
    expect(inbound(runLocationEngine(stateOnly))).toBeDefined();

    const briefWitness = savedPlaceArrivalBoundaryFixture({ includeVisit: false });
    briefWitness.evidence = briefWitness.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-strong-2"
        ? { ...evidence, occurredAt: "2026-09-17T11:34:30.000Z" }
        : evidence
    );
    expect(inbound(runLocationEngine(briefWitness))).toBeDefined();

    const unrelatedCallback = savedPlaceArrivalBoundaryFixture({ includeVisit: false });
    unrelatedCallback.evidence = unrelatedCallback.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-geofence-enter"
        ? { ...evidence, savedPlaceId: "10000000-0000-4000-8000-000000000123" }
        : evidence
    );
    expect(inbound(runLocationEngine(unrelatedCallback))).toBeDefined();
  });

  it("reconciles later same-place evidence instead of freezing at the Visit departure", () => {
    const fixture = savedPlaceArrivalBoundaryFixture();
    const laterInside = fixture.evidence.find((evidence) => evidence.clientEvidenceId === "later-strong-3")!;
    fixture.evidence.push({
      ...laterInside,
      clientEvidenceId: "after-visit-inside",
      occurredAt: "2026-09-17T12:35:00.000Z"
    });
    const stay = gymStay(runLocationEngine(fixture));
    expect(stay?.stoppedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_END);
    expect(stay?.stoppedAt && Date.parse(stay.stoppedAt)).toBeGreaterThan(Date.parse(ARRIVAL_BOUNDARY_VISIT_END));
  });

  it("vetoes reliable movement during the proposed quiet interval", () => {
    const fixture = savedPlaceArrivalBoundaryFixture();
    const movingPoint = fixture.evidence.find((evidence) => evidence.clientEvidenceId === "later-strong-1")!;
    fixture.evidence.push({
      ...movingPoint,
      clientEvidenceId: "moving-inside-quiet-interval",
      occurredAt: "2026-09-17T12:00:00.000Z",
      speedMetersPerSecond: 10
    });
    expect(gymStay(runLocationEngine(fixture))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
  });

  it("does not suppress a spanning commute when credible away travel explains the gap", () => {
    const fixture = savedPlaceArrivalBoundaryFixture({ includeVisit: false });
    const template = fixture.evidence.find((evidence) => evidence.clientEvidenceId === "route-out-3")!;
    fixture.evidence.push(
      { ...template, clientEvidenceId: "away-after-witness-1", occurredAt: "2026-09-17T11:50:00.000Z", latitude: 51.51, longitude: -0.06 },
      { ...template, clientEvidenceId: "away-after-witness-2", occurredAt: "2026-09-17T11:55:00.000Z", latitude: 51.52, longitude: -0.04 }
    );
    expect(inbound(runLocationEngine(fixture))).toBeDefined();
  });

  it("vetoes ambiguity, competing places, unresolved exits, and simulated support", () => {
    const ambiguous = savedPlaceArrivalBoundaryFixture();
    ambiguous.savedPlaces.push({ ...ARRIVAL_BOUNDARY_PLACE, id: "10000000-0000-4000-8000-000000000120", name: ARRIVAL_BOUNDARY_PLACE.name });
    expect(gymStay(runLocationEngine(ambiguous))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const competing = savedPlaceArrivalBoundaryFixture();
    competing.savedPlaces.push({ id: "10000000-0000-4000-8000-000000000123", name: "Synthetic other place", latitude: 51.503, longitude: -0.08, radiusMeters: 90 });
    const otherPlacePoint = competing.evidence.find((evidence) => evidence.clientEvidenceId === "later-strong-2")!;
    competing.evidence.push({ ...otherPlacePoint, clientEvidenceId: "competing-place", occurredAt: "2026-09-17T12:00:00.000Z", latitude: 51.503, savedPlaceId: null });
    expect(gymStay(runLocationEngine(competing))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const unresolvedExit = savedPlaceArrivalBoundaryFixture();
    unresolvedExit.evidence.push({
      ...unresolvedExit.evidence.find((evidence) => evidence.clientEvidenceId === "arrival-geofence-enter")!,
      clientEvidenceId: "unresolved-exit",
      kind: "geofence_exit",
      occurredAt: "2026-09-17T12:00:00.000Z"
    });
    expect(gymStay(runLocationEngine(unresolvedExit))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);

    const simulated = savedPlaceArrivalBoundaryFixture();
    simulated.evidence = simulated.evidence.map((evidence) =>
      evidence.clientEvidenceId === "arrival-strong-2" ? { ...evidence, isSimulated: true } : evidence
    );
    expect(gymStay(runLocationEngine(simulated))?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
  });

  it("preserves A-to-B-to-A separation instead of merging through the broad Visit", () => {
    const fixture = savedPlaceArrivalBoundaryFixture();
    const otherPlace = { id: "10000000-0000-4000-8000-000000000123", name: "Synthetic intermediate place", latitude: 51.503, longitude: -0.08, radiusMeters: 90 };
    fixture.savedPlaces.push(otherPlace);
    const template = fixture.evidence.find((evidence) => evidence.clientEvidenceId === "later-strong-2")!;
    fixture.evidence.push(
      { ...template, clientEvidenceId: "intermediate-1", occurredAt: "2026-09-17T12:00:00.000Z", latitude: otherPlace.latitude, longitude: otherPlace.longitude },
      { ...template, clientEvidenceId: "intermediate-2", occurredAt: "2026-09-17T12:05:00.000Z", latitude: otherPlace.latitude, longitude: otherPlace.longitude },
      { ...template, clientEvidenceId: "intermediate-3", occurredAt: "2026-09-17T12:10:00.000Z", latitude: otherPlace.latitude, longitude: otherPlace.longitude }
    );
    const result = runLocationEngine(fixture);
    expect(result.segmentUpserts.filter((segment) => segment.kind === "stay").map((segment) => segment.placeId)).toEqual(
      expect.arrayContaining([ARRIVAL_BOUNDARY_PLACE.id, otherPlace.id])
    );
    expect(gymStay(result)?.startedAt).not.toBe(ARRIVAL_BOUNDARY_VISIT_AT);
  });

  it("keeps new inferred boundaries out of automatic logging in review and enabled modes", () => {
    const result = output();
    const affected = result.segmentUpserts.filter((segment) =>
      (segment.kind === "stay" && segment.placeId === ARRIVAL_BOUNDARY_PLACE.id) ||
      (segment.kind === "commute" && (segment.fromPlaceId === ARRIVAL_BOUNDARY_PLACE.id || segment.toPlaceId === ARRIVAL_BOUNDARY_PLACE.id))
    );
    expect(affected.length).toBeGreaterThan(0);
    for (const segment of affected) {
      expect(assessAutomaticLocation("v2_review", segment).action).toBe("review");
      expect(assessAutomaticLocation("v2_enabled", segment).action).toBe("review");
    }

    const unchangedStrongCommute: CommuteSegment = {
      kind: "commute",
      clientSegmentId: "unchanged-strong-commute",
      algorithmVersion: LOCATION_ENGINE_V2_CONFIG.algorithmVersion,
      status: "finalised",
      startedAt: "2026-09-17T10:00:00.000Z",
      stoppedAt: "2026-09-17T11:00:00.000Z",
      startLowerBoundAt: "2026-09-17T10:00:00.000Z",
      startUpperBoundAt: "2026-09-17T10:00:00.000Z",
      stopLowerBoundAt: "2026-09-17T11:00:00.000Z",
      stopUpperBoundAt: "2026-09-17T11:00:00.000Z",
      fromStaySegmentId: "from",
      toStaySegmentId: "to",
      fromPlaceId: "origin",
      toPlaceId: "destination",
      routeDistanceMeters: 2_000,
      straightLineDistanceMeters: 1_000,
      routeSampleCount: 3,
      gapDurationSeconds: 3_600,
      maximumObservationGapSeconds: 300,
      continuityStatus: "continuous",
      confidence: "medium_high",
      qualificationReason: "significant_endpoint_displacement",
      evidenceIds: ["route-1", "route-2", "route-3"]
    };
    expect(assessAutomaticLocation("v2_enabled", unchangedStrongCommute).action).toBe("auto_confirm");
  });

  it("uses occurrence order and leaves caller input unchanged", () => {
    const fixture = savedPlaceArrivalBoundaryFixture();
    const before = JSON.stringify(fixture);
    const expected = runLocationEngine(fixture).segmentUpserts;
    const shuffled = {
      ...fixture,
      evidence: [...fixture.evidence].reverse().map((evidence: LocationEvidence) => ({
        ...evidence,
        receivedAt: "2026-09-17T16:00:00.000Z"
      }))
    };
    shuffled.evidence.push({ ...shuffled.evidence[0] });
    expect(runLocationEngine(shuffled).segmentUpserts).toEqual(expected);
    expect(JSON.stringify(fixture)).toBe(before);
  });

  it("keeps a finite arrival-rich workload deterministic", () => {
    const fixture = savedPlaceArrivalBoundaryPerformanceFixture();
    const first = runLocationEngine(fixture);
    const second = runLocationEngine(fixture);

    expect(fixture.evidence).toHaveLength(1_040);
    expect(first.segmentUpserts.filter((segment) => segment.kind === "stay")).toHaveLength(20);
    expect(second.segmentUpserts).toEqual(first.segmentUpserts);
  });
});
