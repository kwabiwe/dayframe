import { describe, expect, it } from "vitest";
import { deriveCommutes } from "../src/location/commute";
import { LOCATION_ENGINE_V2_CONFIG } from "../src/location/config";
import { runLocationEngine } from "../src/location/segmenter";
import { localDateKey, stableLocationId } from "../src/location/geo";
import { assessAutomaticLocation } from "../src/location/automaticPolicy";
import type { LocationEngineInput, StaySegment } from "../src/location/types";
import { shortAt, shortJourneysFixture } from "./fixtures/shortJourneys";
import { shiftedCompletedUnknownVisitFixture, unknownVisitArrivalFixture } from "./fixtures/unknownVisitArrival";

const arrival = "2026-09-27T10:28:03.000Z";
const departure = "2026-09-27T10:51:38.000Z";
const lastMovement = "2026-09-27T10:27:44.000Z";

function unknownStay(input: LocationEngineInput) {
  return runLocationEngine(input).segmentUpserts.find((segment): segment is StaySegment =>
    segment.kind === "stay" && segment.placeMatchKind === "unknown" &&
    segment.evidenceIds.includes("visit-completed")
  );
}

describe("unknown native Visit arrival uncertainty", () => {
  it("keeps the plausible Visit estimate without exact-looking arrival bounds", () => {
    const fixture = unknownVisitArrivalFixture();
    const result = runLocationEngine(fixture);
    const stay = unknownStay(fixture);
    expect(stay).toBeDefined();
    expect(stay).toMatchObject({
      startedAt: "2026-09-27T10:28:03.000Z",
      stoppedAt: "2026-09-27T10:51:38.000Z",
      startLowerBoundAt: "2026-09-27T10:27:44.000Z",
      startUpperBoundAt: "2026-09-27T10:51:38.000Z",
      approximateArrival: true,
      stopLowerBoundAt: "2026-09-27T10:51:38.000Z",
      stopUpperBoundAt: "2026-09-27T10:51:38.000Z"
    });
    const inbound = result.segmentUpserts.find((segment) =>
      segment.kind === "commute" && segment.toStaySegmentId === stay?.clientSegmentId
    );
    expect(inbound).toMatchObject({
      stoppedAt: stay?.startedAt,
      stopLowerBoundAt: stay?.startLowerBoundAt,
      stopUpperBoundAt: stay?.startUpperBoundAt
    });
    expect(inbound?.evidenceIds).toEqual(["route-1", "route-2", "route-last-moving"]);
    expect(stay?.clientSegmentId).toBe(stableLocationId("stay", [
      fixture.config.algorithmVersion,
      fixture.evidence[0].deviceId,
      "visit-arrival",
      "later-slow",
      "unknown"
    ]));
  });

  it("uses the Visit departure as an upper constraint without later stationary support", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.filter((item) => item.clientEvidenceId !== "later-slow");
    expect(unknownStay(input)).toMatchObject({
      startedAt: arrival,
      stoppedAt: departure,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure,
      stopLowerBoundAt: departure,
      stopUpperBoundAt: departure
    });
  });

  it("does not infer a movement-backed lower bound after a long quiet period", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.filter((item) => item.clientEvidenceId !== "route-last-moving" &&
      item.clientEvidenceId !== "route-2" && item.clientEvidenceId !== "later-slow");
    const stay = unknownStay(input);
    expect(stay).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: arrival,
      startUpperBoundAt: arrival,
      stoppedAt: departure
    });
    expect(stay).not.toHaveProperty("approximateArrival");
    // A broad coordinate is not by itself a clock-error measurement. With no
    // recent independent movement, the narrow risk flag has no lower witness.
  });

  it("keeps an accurate arrival-only callback exact without a movement witness", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.filter((item) => item.clientEvidenceId !== "visit-completed" &&
      item.clientEvidenceId !== "route-last-moving" && item.clientEvidenceId !== "route-2");
    input.evidence.push({
      ...input.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
      clientEvidenceId: "later-stationary",
      occurredAt: "2026-09-27T10:42:00.000Z",
      sourceTimestamp: "2026-09-27T10:42:00.000Z"
    });
    const stay = runLocationEngine(input).segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.evidenceIds.includes("visit-arrival"));
    expect(stay).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: arrival,
      startUpperBoundAt: arrival
    });
    expect(stay).not.toHaveProperty("approximateArrival");
  });

  it("keeps a high-quality 11m33 internal Visit exact and below the unchanged Review gate", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "visit-completed"
      ? { ...item, horizontalAccuracyMeters: 54, endedAt: "2026-09-27T10:39:36.000Z" }
      : item);
    const stay = unknownStay(input);
    expect(stay).toMatchObject({
      startedAt: arrival,
      stoppedAt: "2026-09-27T10:39:36.000Z",
      startLowerBoundAt: arrival,
      startUpperBoundAt: arrival
    });
    expect(stay).not.toHaveProperty("approximateArrival");
    expect(Date.parse(stay!.stoppedAt!) - Date.parse(stay!.startedAt)).toBe(693_000);
    expect(Date.parse(stay!.stoppedAt!) - Date.parse(stay!.startedAt)).toBeLessThan(input.config.unknownStayReviewDwellMs);
  });

  it("requires recent accurate non-simulated native movement, not slow traffic or spatial noise", () => {
    for (const patch of [
      { speedMetersPerSecond: 0.76 },
      { horizontalAccuracyMeters: 90 },
      { isSimulated: true },
      { latitude: 51.5099 }
    ]) {
      const input = unknownVisitArrivalFixture();
      input.evidence = input.evidence.map((item) => item.clientEvidenceId === "route-last-moving"
        ? { ...item, ...patch } : item);
      expect(unknownStay(input)?.startLowerBoundAt, JSON.stringify(patch)).toBe(arrival);
      expect(unknownStay(input)?.startUpperBoundAt, JSON.stringify(patch)).toBe(arrival);
    }
    const sparse = unknownVisitArrivalFixture();
    sparse.evidence = sparse.evidence.filter((item) => item.clientEvidenceId !== "route-last-moving");
    expect(unknownStay(sparse)?.startLowerBoundAt).toBe(arrival);
  });

  it("does not use later slow or walking samples as the arrival instant", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence.push({
      ...input.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
      clientEvidenceId: "walking-after-parking",
      occurredAt: "2026-09-27T10:36:00.000Z",
      sourceTimestamp: "2026-09-27T10:36:00.000Z",
      latitude: 51.5101,
      speedMetersPerSecond: 2.1
    });
    expect(unknownStay(input)).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure
    });
  });

  it("does not retain the early Visit stay when a later accurate route contradicts it", () => {
    const input = unknownVisitArrivalFixture();
    const routePoint = input.evidence.find((item) => item.clientEvidenceId === "route-last-moving")!;
    input.evidence.push({
      ...routePoint,
      clientEvidenceId: "continued-route-1",
      occurredAt: "2026-09-27T10:29:30.000Z",
      sourceTimestamp: "2026-09-27T10:29:30.000Z",
      latitude: 51.512,
      speedMetersPerSecond: 5.2
    }, {
      ...routePoint,
      clientEvidenceId: "continued-route-2",
      occurredAt: "2026-09-27T10:30:30.000Z",
      sourceTimestamp: "2026-09-27T10:30:30.000Z",
      latitude: 51.514,
      speedMetersPerSecond: 4.8
    });
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "later-slow"
      ? { ...item, latitude: 51.5141, longitude: -0.12 }
      : item);
    expect(unknownStay(input)).toBeUndefined();
  });

  it("leaves an arrival-only upper bound unavailable, then converges on full replay", () => {
    const input = unknownVisitArrivalFixture();
    const first = structuredClone(input);
    first.evidence = first.evidence.filter((item) => item.clientEvidenceId !== "visit-completed");
    for (const [index, time] of ["10:36:00.000", "10:40:00.000"].entries()) {
      first.evidence.push({
        ...first.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
        clientEvidenceId: `extra-stationary-${index}`,
        occurredAt: `2026-09-27T${time}Z`,
        sourceTimestamp: `2026-09-27T${time}Z`
      });
    }
    const provisional = runLocationEngine(first).segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.evidenceIds.includes("visit-arrival")
    );
    expect(provisional).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: null,
      approximateArrival: true
    });
    const full = { ...first, evidence: [...first.evidence, input.evidence.find((item) =>
      item.clientEvidenceId === "visit-completed")!] };
    const completed = unknownStay(full);
    expect(completed).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure,
      approximateArrival: true
    });
    expect(runLocationEngine({ ...full, evidence: [...full.evidence].reverse() }).segmentUpserts)
      .toEqual(runLocationEngine(full).segmentUpserts);
    expect(runLocationEngine({ ...full, evidence: [...full.evidence, ...full.evidence] }).segmentUpserts)
      .toEqual(runLocationEngine(full).segmentUpserts);
  });

  it("keeps a witnessed arrival approximate when its paired broad completion shifts toward movement", () => {
    const full = shiftedCompletedUnknownVisitFixture();
    const arrivalOnly = structuredClone(full);
    arrivalOnly.evidence = arrivalOnly.evidence.filter((item) => item.clientEvidenceId !== "visit-completed");
    for (const [index, time] of ["10:36:00.000", "10:40:00.000"].entries()) {
      arrivalOnly.evidence.push({
        ...arrivalOnly.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
        clientEvidenceId: `shifted-stationary-${index}`,
        occurredAt: `2026-09-27T${time}Z`,
        sourceTimestamp: `2026-09-27T${time}Z`
      });
    }
    const provisional = runLocationEngine(arrivalOnly).segmentUpserts.find((segment) =>
      segment.kind === "stay" && segment.evidenceIds.includes("visit-arrival"));
    expect(provisional).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: null,
      approximateArrival: true
    });
    const retained = { ...arrivalOnly, evidence: [
      ...arrivalOnly.evidence,
      full.evidence.find((item) => item.clientEvidenceId === "visit-completed")!
    ] };
    expect(unknownStay(retained)).toMatchObject({
      startedAt: arrival,
      stoppedAt: departure,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure,
      approximateArrival: true
    });
  });

  it("preserves shifted-pair semantics across input order and callback IDs", () => {
    const input = shiftedCompletedUnknownVisitFixture();
    const swapped = shiftedCompletedUnknownVisitFixture();
    swapped.evidence = swapped.evidence.map((item) => ({
      ...item,
      clientEvidenceId: item.clientEvidenceId === "visit-arrival" ? "visit-completed" :
        item.clientEvidenceId === "visit-completed" ? "visit-arrival" : item.clientEvidenceId
    }));
    const semantic = (fixture: LocationEngineInput) => runLocationEngine(fixture).segmentUpserts
      .filter((segment): segment is StaySegment => segment.kind === "stay" &&
        segment.placeMatchKind === "unknown")
      .map((segment) => ({
        startedAt: segment.startedAt,
        stoppedAt: segment.stoppedAt,
        lower: segment.startLowerBoundAt,
        upper: segment.startUpperBoundAt,
        approximateArrival: segment.approximateArrival ?? false
      }));
    expect(semantic({ ...input, evidence: [...input.evidence].reverse() })).toEqual(semantic(input));
    expect(semantic(swapped)).toEqual(semantic(input));
    expect(semantic({ ...swapped, evidence: [...swapped.evidence].reverse() })).toEqual(semantic(input));
  });

  it("uses the arrival callback as the deterministic equal-accuracy reference", () => {
    const input = shiftedCompletedUnknownVisitFixture();
    input.evidence = input.evidence.map((item) =>
      item.clientEvidenceId === "visit-arrival"
        ? { ...item, horizontalAccuracyMeters: 70.4 }
        : item);
    expect(unknownStay(input)).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure,
      approximateArrival: true
    });
    expect(unknownStay({ ...input, evidence: [...input.evidence].reverse() })?.startLowerBoundAt)
      .toBe(lastMovement);
    const swapped = { ...input, evidence: input.evidence.map((item) => ({
      ...item,
      clientEvidenceId: item.clientEvidenceId === "visit-arrival" ? "visit-completed" :
        item.clientEvidenceId === "visit-completed" ? "visit-arrival" : item.clientEvidenceId
    })) };
    expect(unknownStay(swapped)?.startLowerBoundAt).toBe(lastMovement);
  });

  it("uses a more accurate completed callback centre while retaining its broad quality gate", () => {
    const shifted = shiftedCompletedUnknownVisitFixture();
    shifted.evidence = shifted.evidence.map((item) =>
      item.clientEvidenceId === "visit-arrival"
        ? { ...item, horizontalAccuracyMeters: 90 }
        : item);
    const exact = unknownStay(shifted);
    expect(exact).toMatchObject({
      startedAt: arrival,
      stoppedAt: departure,
      startLowerBoundAt: arrival,
      startUpperBoundAt: arrival
    });
    expect(exact).not.toHaveProperty("approximateArrival");

    const fartherCompletion = structuredClone(shifted);
    fartherCompletion.evidence = fartherCompletion.evidence.map((item) =>
      item.clientEvidenceId === "visit-arrival"
        ? { ...item, latitude: 51.5094 }
        : item.clientEvidenceId === "visit-completed"
          ? { ...item, latitude: 51.51 }
          : item);
    expect(unknownStay(fartherCompletion)).toMatchObject({
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure,
      approximateArrival: true
    });
  });

  it("uses unknown Visit bounds when stationaryOutside restarts a stay", () => {
    const input = unknownVisitArrivalFixture();
    const origin = input.evidence.find((item) => item.clientEvidenceId === "origin-visit")!;
    input.evidence = input.evidence.filter((item) => !["route-1", "route-2", "origin-visit", "visit-completed"].includes(item.clientEvidenceId));
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "route-last-moving"
      ? { ...item, occurredAt: "2026-09-27T10:25:44.000Z", sourceTimestamp: "2026-09-27T10:25:44.000Z" }
      : item);
    input.evidence.unshift({
      ...origin,
      clientEvidenceId: "origin-recent",
      kind: "standard_location",
      occurredAt: "2026-09-27T10:25:00.000Z",
      sourceTimestamp: "2026-09-27T10:25:00.000Z",
      endedAt: null,
      speedMetersPerSecond: 0
    });
    input.evidence.push({
      ...input.evidence.find((item) => item.clientEvidenceId === "later-slow")!,
      clientEvidenceId: "later-stationary",
      occurredAt: "2026-09-27T10:42:00.000Z",
      sourceTimestamp: "2026-09-27T10:42:00.000Z"
    });
    const result = runLocationEngine(input);
    const stay = result.segmentUpserts.find((segment) => segment.kind === "stay" &&
      segment.evidenceIds.includes("visit-arrival"));
    expect(stay).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: "2026-09-27T10:25:44.000Z",
      startUpperBoundAt: null,
      approximateArrival: true
    });
  });

  it("handles a completed callback alone and does not pair competing or non-overlapping callbacks", () => {
    const completedOnly = unknownVisitArrivalFixture();
    completedOnly.evidence = completedOnly.evidence.filter((item) => item.clientEvidenceId !== "visit-arrival");
    expect(unknownStay(completedOnly)).toMatchObject({
      startedAt: arrival,
      startLowerBoundAt: lastMovement,
      startUpperBoundAt: departure
    });

    const colliding = unknownVisitArrivalFixture();
    colliding.evidence.push({
      ...colliding.evidence.find((item) => item.clientEvidenceId === "visit-arrival")!,
      clientEvidenceId: "visit-arrival-other"
    });
    expect(unknownStay(colliding)?.startUpperBoundAt).toBeNull();

    const separated = unknownVisitArrivalFixture();
    separated.evidence = separated.evidence.map((item) => item.clientEvidenceId === "visit-arrival"
      ? { ...item, latitude: 51.51095, horizontalAccuracyMeters: 5 }
      : item);
    expect(unknownStay(separated)?.startUpperBoundAt).toBeNull();
  });

  it("keeps the ten-minute candidate gate and Visit departure after a short stop", () => {
    const input = unknownVisitArrivalFixture();
    input.evidence = input.evidence.map((item) => item.clientEvidenceId === "visit-completed"
      ? { ...item, endedAt: "2026-09-27T10:37:00.000Z" } : item);
    expect(unknownStay(input)).toBeUndefined();
  });

  it("uses absolute instants consistently through the Europe/London fall-back", () => {
    const input = unknownVisitArrivalFixture();
    const shift = (iso: string) => new Date(Date.parse(iso) - Date.parse("2026-09-27T10:00:00.000Z") +
      Date.parse("2026-10-25T00:20:00.000Z")).toISOString();
    input.evidence = input.evidence.map((item) => ({
      ...item,
      occurredAt: shift(item.occurredAt),
      endedAt: item.endedAt ? shift(item.endedAt) : null,
      receivedAt: shift(item.receivedAt),
      sourceTimestamp: item.sourceTimestamp ? shift(item.sourceTimestamp) : null
    }));
    input.processingAt = shift(input.processingAt);
    expect(unknownStay(input)).toMatchObject({
      startedAt: shift(arrival),
      startLowerBoundAt: shift(lastMovement),
      startUpperBoundAt: shift(departure),
      stoppedAt: shift(departure)
    });
  });

  it("keeps source bounds ordered across a Europe/London local-day boundary", () => {
    const input = unknownVisitArrivalFixture();
    const shift = (iso: string) => new Date(Date.parse(iso) - Date.parse("2026-09-27T10:00:00.000Z") +
      Date.parse("2026-10-24T22:20:00.000Z")).toISOString();
    input.evidence = input.evidence.map((item) => ({
      ...item,
      occurredAt: shift(item.occurredAt),
      endedAt: item.endedAt ? shift(item.endedAt) : null,
      receivedAt: shift(item.receivedAt),
      sourceTimestamp: item.sourceTimestamp ? shift(item.sourceTimestamp) : null
    }));
    input.processingAt = shift(input.processingAt);
    const stay = unknownStay(input)!;
    expect(stay.startLowerBoundAt).toBe(shift(lastMovement));
    expect(stay.startedAt).toBe(shift(arrival));
    expect(stay.startUpperBoundAt).toBe(shift(departure));
    expect(localDateKey(stay.startedAt, "Europe/London")).not.toBe(
      localDateKey(stay.stoppedAt!, "Europe/London"));
  });

  it("keeps a 76.140-second #209-style short journey Review-only", () => {
    const input = shortJourneysFixture();
    const oldArrival = Date.parse(shortAt(684_496));
    const offset = 8_356;
    input.evidence = input.evidence.map((item) => {
      const shift = (value: string) => Date.parse(value) >= oldArrival
        ? new Date(Date.parse(value) - offset).toISOString() : value;
      return {
        ...item,
        occurredAt: shift(item.occurredAt),
        endedAt: item.endedAt ? shift(item.endedAt) : null,
        sourceTimestamp: item.sourceTimestamp ? shift(item.sourceTimestamp) : null
      };
    });
    const output = runLocationEngine(input);
    const stays = output.segmentUpserts.filter((segment): segment is StaySegment => segment.kind === "stay");
    const trips = output.segmentUpserts.filter((segment) => segment.kind === "commute");
    // The 76.140 s leg ends at a short unknown stop, so it is recorded inside one trip.
    expect(trips).toHaveLength(1);
    expect(Date.parse(trips[0].stops![0].startedAt) - Date.parse(trips[0].startedAt)).toBe(76_140);
    expect(assessAutomaticLocation("v2_enabled", trips[0])).toMatchObject({
      action: "review", reason: "journey_contains_stop"
    });
    const [leg] = deriveCommutes(stays, output.acceptedEvidence, LOCATION_ENGINE_V2_CONFIG, input.processingAt);
    expect(Date.parse(leg.stoppedAt) - Date.parse(leg.startedAt)).toBe(76_140);
    expect(assessAutomaticLocation("v2_enabled", leg)).toMatchObject({
      action: "review", reason: "short_journey_review_only"
    });
  });
});
